#!/usr/bin/env bun

/**
 * Regenerates data/attributes.json from the installed game.
 *
 * Unlike sync-data.ts, this data is not in the AlchemyFactoryData repository — the research
 * ladders only exist inside the game's own DataTables, so this reads the shipped paks:
 *   DT_Attributes   -> base value and unit for every attribute
 *   DT_Improvements -> the per-level effect of each research node
 *   DT_UpgradePoints -> how many times a repeatable node can be bought (MaxUnlimitedLevel, 0 = no limit)
 *
 * Usage:
 *   bun run extract-attributes --usmap <Mappings.usmap> [--paks <Paks dir>]
 *   bun run extract-attributes --from <dir with DT_Attributes, DT_Improvements and DT_UpgradePoints .json>
 *
 * The .usmap is required because UE5 shipping builds strip property names. Generate one once
 * per game version by injecting Dumper-7 (https://github.com/Encryqed/Dumper-7) into the running
 * game; it writes Mappings/<version>.usmap under C:\Dumper-7\<version>-AlchemyFactory\.
 *
 * With --usmap this script writes a throwaway C# project to a temp dir and runs it via
 * `dotnet run` (needs the .NET SDK); it pulls CUE4Parse from NuGet to read the paks.
 * With --from it just transforms DataTable JSON you exported some other way (e.g. FModel).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = './data';
const DEFAULT_PAKS =
  'C:/Program Files (x86)/Steam/steamapps/common/Alchemy Factory/AlchemyFactory/Content/Paks';
const CUE4PARSE_VERSION = '1.2.2.202609';
const UE_VERSION = 'GAME_UE5_7';

interface AttributeRow {
  BaseValue: number;
  AttributeUnit?: { SourceString?: string };
}

interface ImprovementRow {
  ImprovementLevel: number;
  AllowRepeat: boolean;
  Deprecated: boolean;
  Effects?: { AttributeName: string; ModificationType: string; ModValue: number }[];
}

interface UpgradePointRow {
  IsUnlimited: boolean;
  MaxUnlimitedLevel: number;
  Deprecated: boolean;
  UnlockItem?: { ConfigName: string };
}

interface AttributeLadder {
  base: number;
  unit: string;
  steps: number[];
  repeatStep: number | null;
  maxRepeats?: number;
  modType?: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1] ?? '';
  }
  return args;
}

/** Reads the `Rows` map out of a CUE4Parse DataTable export. */
async function readTable<T>(dir: string, name: string): Promise<Record<string, T>> {
  const raw = await readFile(join(dir, `${name}.json`), 'utf-8');
  const rows = JSON.parse(raw)[0]?.Rows;
  if (!rows) throw new Error(`${name}.json has no Rows — is it a DataTable export?`);
  return rows;
}

/** Writes and runs a throwaway CUE4Parse project that dumps the two DataTables we need. */
async function exportTables(paks: string, usmap: string): Promise<string> {
  const dir = join(tmpdir(), `af-attributes-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  await writeFile(
    join(dir, 'dump.csproj'),
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>dump</AssemblyName>
    <RootNamespace>dump</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="CUE4Parse" Version="${CUE4PARSE_VERSION}" />
  </ItemGroup>
</Project>
`
  );

  await writeFile(
    join(dir, 'Program.cs'),
    `using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.MappingsProvider.Usmap;
using Newtonsoft.Json;

var provider = new DefaultFileProvider(args[0], SearchOption.AllDirectories,
    new VersionContainer(EGame.${UE_VERSION}));
provider.Initialize();
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(args[1]);
provider.Mount();

foreach (var name in new[] { "DT_Attributes", "DT_Improvements", "DT_UpgradePoints" })
{
    var path = $"AlchemyFactory/Content/DataTables/{name}.uasset";
    var exports = provider.LoadPackage(path).GetExports();
    File.WriteAllText(Path.Combine(args[2], name + ".json"),
        JsonConvert.SerializeObject(exports, Formatting.Indented));
    Console.WriteLine("exported " + name);
}
`
  );

  console.log('🔨 Building CUE4Parse extractor (first run downloads the NuGet package)...');
  const proc = Bun.spawn(['dotnet', 'run', '--project', dir, '--', paks, usmap, dir], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`dotnet run failed with exit code ${code}`);

  return dir;
}

/**
 * Merges the two tables into one ladder per attribute.
 * Add and Increase are both additive on top of the base value (Increase just means the attribute
 * is a percentage), so a level's value is base + the sum of every step up to it. Deprecated
 * improvements are dropped — several attributes have a stale ladder alongside the live one.
 * A repeatable top step gets `maxRepeats` when its research node caps the repeats.
 */
function buildLadders(
  attributes: Record<string, AttributeRow>,
  improvements: Record<string, ImprovementRow>,
  upgradePoints: Record<string, UpgradePointRow>
): Record<string, AttributeLadder> {
  const repeatCap: Record<string, number> = {}; // improvement row name -> max repeats
  for (const point of Object.values(upgradePoints)) {
    const name = point.UnlockItem?.ConfigName;
    if (name && point.IsUnlimited && !point.Deprecated && point.MaxUnlimitedLevel > 0) {
      repeatCap[name] = point.MaxUnlimitedLevel;
    }
  }

  const ladders: Record<string, AttributeLadder> = {};
  for (const [name, attr] of Object.entries(attributes)) {
    ladders[name] = {
      base: attr.BaseValue,
      unit: attr.AttributeUnit?.SourceString || '',
      steps: [],
      repeatStep: null,
    };
  }

  const effectsByAttribute: Record<
    string,
    { level: number; value: number; type: string; repeat: boolean; maxRepeats?: number }[]
  > = {};
  for (const [rowName, row] of Object.entries(improvements)) {
    if (row.Deprecated) continue;
    for (const effect of row.Effects || []) {
      if (!ladders[effect.AttributeName]) continue;
      (effectsByAttribute[effect.AttributeName] ??= []).push({
        level: row.ImprovementLevel,
        value: effect.ModValue,
        type: effect.ModificationType.split('::')[1] || effect.ModificationType,
        repeat: row.AllowRepeat,
        maxRepeats: repeatCap[rowName],
      });
    }
  }

  for (const [name, effects] of Object.entries(effectsByAttribute)) {
    effects.sort((a, b) => a.level - b.level);

    const types = new Set(effects.map((e) => e.type));
    if (types.size > 1) {
      console.warn(`⚠️  ${name} mixes modification types (${[...types].join(', ')}) — check it by hand`);
    }

    const last = effects[effects.length - 1];
    ladders[name].steps = effects.map((e) => e.value);
    ladders[name].repeatStep = last.repeat ? last.value : null;
    if (last.repeat && last.maxRepeats) ladders[name].maxRepeats = last.maxRepeats;
    ladders[name].modType = last.type;
  }

  return ladders;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let exportDir = args.from;
  let temporary = false;

  if (!exportDir) {
    if (!args.usmap) {
      console.error('Need --usmap <file> (or --from <dir>). See the header of this file.');
      process.exit(1);
    }
    exportDir = await exportTables(args.paks || DEFAULT_PAKS, args.usmap);
    temporary = true;
  }

  try {
    console.log('📖 Reading DataTables...');
    const attributes = await readTable<AttributeRow>(exportDir, 'DT_Attributes');
    const improvements = await readTable<ImprovementRow>(exportDir, 'DT_Improvements');
    const upgradePoints = await readTable<UpgradePointRow>(exportDir, 'DT_UpgradePoints');
    console.log(
      `✅ ${Object.keys(attributes).length} attributes, ${Object.keys(improvements).length} improvements\n`
    );

    const ladders = buildLadders(attributes, improvements, upgradePoints);
    const withLadders = Object.values(ladders).filter((l) => l.steps.length > 0).length;

    await writeFile(`${DATA_DIR}/attributes.json`, JSON.stringify(ladders, null, 2));

    console.log(`✅ Wrote data/attributes.json`);
    console.log(`  - ${Object.keys(ladders).length} attributes (${withLadders} with research ladders)`);
  } finally {
    if (temporary) await rm(exportDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Extraction failed:', err.message);
  process.exit(1);
});
