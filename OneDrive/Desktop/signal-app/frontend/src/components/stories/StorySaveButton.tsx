"use client";

import { useStorySave } from "@/hooks/useStorySave";
import type { Story } from "@/types/story";
import { SaveButton } from "./SaveButton";

interface StorySaveButtonProps {
  story: Story;
  className?: string;
}

export function StorySaveButton({ story, className }: StorySaveButtonProps): JSX.Element {
  const { isSaved, toggleSave, isLoading } = useStorySave(story);
  return (
    <SaveButton
      saved={isSaved}
      onToggle={toggleSave}
      disabled={isLoading}
      className={className}
    />
  );
}
