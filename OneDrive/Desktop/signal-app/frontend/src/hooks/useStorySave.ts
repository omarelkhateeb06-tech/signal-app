"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveStoryRequest, unsaveStoryRequest } from "@/lib/api";
import type { Story, SaveToggleResponse } from "@/types/story";

interface UseStorySaveResult {
  isSaved: boolean;
  saveCount: number;
  toggleSave: () => void;
  isLoading: boolean;
}

export function useStorySave(story: Story): UseStorySaveResult {
  const queryClient = useQueryClient();

  const applyToOtherCaches = (
    storyId: string,
    next: SaveToggleResponse,
  ): void => {
    queryClient.setQueriesData<{
      pages: Array<{ stories: Story[] }>;
      pageParams: unknown[];
    }>({ queryKey: ["feed"] }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          stories: page.stories.map((s) =>
            s.id === storyId
              ? { ...s, is_saved: next.saved, save_count: next.save_count }
              : s,
          ),
        })),
      };
    });
    queryClient.setQueryData<Story | undefined>(["story", storyId], (prev) =>
      prev ? { ...prev, is_saved: next.saved, save_count: next.save_count } : prev,
    );
  };

  const mutation = useMutation<
    SaveToggleResponse,
    Error,
    void,
    { previous: { saved: boolean; count: number } }
  >({
    mutationFn: async () =>
      story.is_saved ? unsaveStoryRequest(story.id) : saveStoryRequest(story.id),
    onMutate: async () => {
      const previous = { saved: story.is_saved, count: story.save_count };
      const optimistic: SaveToggleResponse = {
        saved: !previous.saved,
        save_count: Math.max(0, previous.count + (previous.saved ? -1 : 1)),
      };
      applyToOtherCaches(story.id, optimistic);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) {
        applyToOtherCaches(story.id, {
          saved: ctx.previous.saved,
          save_count: ctx.previous.count,
        });
      }
    },
    onSuccess: (data) => {
      applyToOtherCaches(story.id, data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["saves"] });
    },
  });

  return {
    isSaved: story.is_saved,
    saveCount: story.save_count,
    toggleSave: () => mutation.mutate(),
    isLoading: mutation.isPending,
  };
}
