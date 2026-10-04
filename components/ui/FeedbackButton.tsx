import { MessageSquarePlus } from "lucide-react";
import { REPO_URL } from "@/lib/site";
import { cn } from "../../lib/utils";

// ponytail: feedback is a GitHub issue (needs a GitHub account); add a form + server-side issue creation if non-GitHub users need a way in
const FEEDBACK_URL = `${REPO_URL}/issues/new?${new URLSearchParams({
  title: "Feedback: ",
  body: "**What happened or what would you like?**\n\n\n**Factory or page (optional, a share link helps):**\n",
})}`;

export function FeedbackButton() {
  return (
    <a
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 text-sm",
        "text-[var(--text-muted)] hover:text-[var(--accent-purple)]",
        "border border-[var(--border)] hover:border-[var(--accent-purple-dim)]",
        "rounded-md transition-all",
        "hover:shadow-[0_0_10px_rgba(155,109,255,0.2)]"
      )}
    >
      <MessageSquarePlus className="w-4 h-4" />
      <span className="hidden sm:inline">Feedback</span>
    </a>
  );
}
