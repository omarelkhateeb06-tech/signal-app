import { Sparkles } from "lucide-react";

interface PersonalizationBoxProps {
  text: string;
}

export function PersonalizationBox({ text }: PersonalizationBoxProps): JSX.Element {
  return (
    <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600" />
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
          Why it matters to you
        </p>
        <p className="text-sm leading-relaxed text-slate-800">{text}</p>
      </div>
    </div>
  );
}
