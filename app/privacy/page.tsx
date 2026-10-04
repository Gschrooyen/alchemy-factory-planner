import type { Metadata } from "next";
import { OrnatePanel } from "@/components/ui/OrnatePanel";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Alchemy Factory Tools stores about you and how to remove it.",
};

const sections: { title: string; body: React.ReactNode }[] = [
  {
    title: "Without an account",
    body: "Your servers, factories and skills are saved only in your browser's local storage. Nothing is sent to us.",
  },
  {
    title: "With an account",
    body: "When you sign in with Google, GitHub or an email link, we store your email address and an account id from that provider, plus the servers and factories you create. This is used only to sign you in and sync your plans across devices. We never sell or share it, and we don't send marketing email.",
  },
  {
    title: "Where it's stored",
    body: "Accounts and synced plans are stored with Supabase (database hosted in the United States). The site is hosted on Vercel, which collects anonymous page-view and performance statistics without cookies.",
  },
  {
    title: "Deleting your data",
    body: "Open the account menu and choose “Delete account”. This immediately removes your account and every server and factory saved in it. Signing out also clears the copy on that device.",
  },
  {
    title: "Contact",
    body: (
      <>
        Questions or requests: open an issue on{" "}
        <a href={`${REPO_URL}/issues`} className="text-[var(--accent-gold)] hover:underline" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        .
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <OrnatePanel className="p-6 rounded-xl">
        <div className="flex flex-col gap-5">
          <h1 className="text-2xl font-cinzel text-[var(--accent-gold)]">Privacy Policy</h1>
          {sections.map((s) => (
            <section key={s.title} className="flex flex-col gap-1">
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-primary)]">{s.title}</h2>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>
      </OrnatePanel>
    </div>
  );
}
