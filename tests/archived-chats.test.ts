import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listArchivedThreads, listThreads } from "@/lib/chat-data";

describe("archived conversation history", () => {
  it("loads active and archived conversations independently", async () => {
    const archiveStates: boolean[] = [];
    const rows = {
      active: [{
        id: "044427d1-0e84-4ea3-8104-a6d40f939611",
        title: "Active idea",
        project_id: null,
        archived: false,
        updated_at: "2026-08-13T02:00:00.000Z",
      }],
      archived: [{
        id: "d866016b-bde8-4712-901a-3f016f95fca5",
        title: "Archived idea",
        project_id: "7d249434-7bc8-4c61-b61f-d7c62a65a789",
        archived: true,
        updated_at: "2026-08-12T02:00:00.000Z",
      }],
    };
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("chat_threads");
        return {
          select: (columns: string) => {
            expect(columns).toContain("archived");
            return {
              eq: (column: string, archived: boolean) => {
                expect(column).toBe("archived");
                archiveStates.push(archived);
                return {
                  order: (orderColumn: string, options: { ascending: boolean }) => {
                    expect(orderColumn).toBe("updated_at");
                    expect(options).toEqual({ ascending: false });
                    return {
                      limit: async (limit: number) => ({
                        data: archived ? rows.archived : rows.active,
                        error: limit === 100 ? null : new Error("Unexpected limit"),
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const [active, archived] = await Promise.all([
      listThreads(supabase),
      listArchivedThreads(supabase),
    ]);

    expect(archiveStates).toEqual([false, true]);
    expect(active).toEqual([expect.objectContaining({ title: "Active idea", archived: false })]);
    expect(archived).toEqual([expect.objectContaining({ title: "Archived idea", archived: true })]);
  });
});
