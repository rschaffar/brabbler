"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { followBlockingCard } from "@/lib/blocking-card-scroll";

/** Arrival-follow belongs only to the current live question, never its receipt. */
export function useBlockingQuestionFollow(questionId: string | undefined, loading: boolean, covered: boolean,
  scrollContainerRef: RefObject<HTMLDivElement | null>, questionCardRef: RefObject<HTMLDivElement | null>) {
  const questionFollowRef = useRef<{ id: string; following: boolean } | null>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    const card = questionCardRef.current;
    if (!questionId) { questionFollowRef.current = null; return; }
    if (questionFollowRef.current?.id !== questionId) questionFollowRef.current = { id: questionId, following: true };
    if (loading || covered || !container || !card) return;
    return followBlockingCard(container, card, questionFollowRef.current);
  }, [questionId, loading, covered, scrollContainerRef, questionCardRef]);
  return useCallback(() => {
    if (questionFollowRef.current) questionFollowRef.current.following = false;
  }, []);
}
