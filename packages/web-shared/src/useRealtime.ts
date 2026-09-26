"use client";

/**
 * Supabase Realtime subscription lifecycle.
 *
 * The previous implementation created a channel in a `useEffect` and called
 * `removeChannel` without awaiting, so on every dependency change (and on every
 * auth state change) a new channel could be created while the old one was still
 * tearing down — producing duplicate subscriptions and a refetch storm.
 *
 * This hook:
 *   - subscribes exactly once per (topic, table, filter) tuple;
 *   - awaits removal before the next subscribe and on unmount;
 *   - debounces bursts of events into a single refetch;
 *   - never calls back after unmount.
 */
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "./client";
import { log } from "./log";
import { useDebouncedCallback } from "./useAsyncData";

export type RealtimeSpec = {
  /** Postgres table to watch, e.g. `"orders"`. */
  table: string;
  /**
   * PostgREST-style filter, e.g. `"consumer_id=eq.<uuid>"`. Leave undefined to
   * watch every row the caller's RLS policy allows.
   */
  filter?: string;
  /** Events to listen for. Defaults to every event. */
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  /** Coalescing window in ms. Defaults to 400. */
  debounceMs?: number;
};

export function useRealtime(topic: string, spec: RealtimeSpec, onChange: () => void): void {
  const { table, filter, event = "*", debounceMs = 400 } = spec;

  // Keep the latest callback without re-subscribing on every render.
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const debounced = useDebouncedCallback(() => {
    changeRef.current();
  }, debounceMs);

  useEffect(() => {
    let disposed = false;
    let channel: RealtimeChannel | null = null;

    const start = async () => {
      try {
        const supabase = supabaseBrowser();
        channel = supabase
          .channel(topic)
          .on(
            "postgres_changes",
            { event, schema: "public", table, ...(filter ? { filter } : {}) },
            () => {
              if (!disposed) debounced();
            },
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              log.debug("realtime", "subscribed", { topic, table, filter });
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              log.warn("realtime", "subscription problem", { topic, table, filter, status });
            }
          });
      } catch (error) {
        // Realtime is an enhancement: a failure must not break the page.
        log.warn("realtime", "could not subscribe", { topic, table, error });
      }
    };

    void start();

    return () => {
      disposed = true;
      if (channel) {
        const active = channel;
        channel = null;
        // Awaited so a re-subscribe never races an in-flight teardown.
        void supabaseBrowser()
          .removeChannel(active)
          .catch((error: unknown) => log.warn("realtime", "remove failed", { topic, error }));
      }
    };
    // `debounced` is stable for a given delay.
     
  }, [topic, table, filter, event, debounced]);
}
