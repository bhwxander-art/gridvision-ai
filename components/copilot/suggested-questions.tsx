"use client";

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
  healthScore: number | null;
}

export function SuggestedQuestions({ onSelect, healthScore }: SuggestedQuestionsProps) {
  const questions = [
    healthScore !== null
      ? `Why is the Grid Health Score at ${healthScore} today?`
      : "What is the current grid health status?",
    "What is driving today's peak load?",
    "Which assets are at highest risk right now?",
    "Summarize the next 24 hours of load forecast.",
    "Should this utility invest in new capacity?",
    "What should executives focus on this week?",
    "Generate an executive summary.",
    "Explain the load forecast confidence intervals.",
    "What are the top grid reliability risks?",
    "How does current load compare to historical averages?",
  ];

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-4">
      {questions.map((q) => (
        <button
          key={q}
          onClick={() => onSelect(q)}
          className="rounded-full border border-border/50 bg-background/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent/50 hover:text-foreground"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
