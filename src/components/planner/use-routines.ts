"use client";
import { useEffect, useState } from "react";
import { materializeDay, type RoutineIssue } from "@/lib/db/routines";
/** This effect is the boundary between the viewed date and durable dated occurrences. */
export function useRoutines(
  date: string,
  timezone: string | undefined,
  revision: string,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([date, timezone, revision, attempt]);
  const [result, setResult] = useState<{
    key: string;
    issues: RoutineIssue[];
    error: string;
  }>({ key: "", issues: [], error: "" });
  useEffect(() => {
    if (!date || !timezone) return;
    let cancelled = false;
    materializeDay(date, timezone)
      .then((issues) => {
        if (!cancelled) setResult({ key, issues, error: "" });
      })
      .catch((error) => {
        if (!cancelled)
          setResult({
            key,
            issues: [],
            error:
              error instanceof Error
                ? error.message
                : "Could not load routines.",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [date, timezone, key]);
  return {
    pending: Boolean(date && timezone && result.key !== key),
    issues: result.key === key ? result.issues : [],
    error: result.key === key ? result.error : "",
    retry: () => setAttempt((value) => value + 1),
  };
}
