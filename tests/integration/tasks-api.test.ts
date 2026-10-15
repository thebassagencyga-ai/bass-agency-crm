import { beforeAll, describe, expect, it } from "vitest";
import { PASSWORD, anonClient, createTestUser, fullSessionClient } from "../support/supabase";

// Tasks, activities and profile settings through the real Data API (Phase 5).

const TODAY = "2026-10-15";
const SEARCH = { p_today: TODAY, p_product_line: null, p_priority: null, p_category: null, p_contact_id: null, p_limit: 50, p_offset: 0 };

let ownerEmail = "";
let ownerId = "";
let contactId = "";
let taskId = "";

beforeAll(async () => {
  const owner = await createTestUser("tasks-owner");
  ownerEmail = owner.email;
  ownerId = owner.id;
  const client = await fullSessionClient(owner.email);
  const { data: contact, error } = await client.from("contacts").insert({ contact_type: "individual", first_name: "Sam", last_name: "Example" }).select("id").single();
  if (error) throw error;
  contactId = contact.id;
  const { data: task, error: taskError } = await client.from("tasks").insert({ contact_id: contactId, title: "Call Sam", due_date: TODAY }).select("id").single();
  if (taskError) throw taskError;
  taskId = task.id;
});

describe("tasks and activities via the Data API", () => {
  it("lists today's task and counts it", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { data, error } = await client.rpc("search_tasks", { ...SEARCH, p_view: "today" });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ id: taskId, title: "Call Sam", first_name: "Sam" })]);
    const counts = await client.rpc("task_counts", { p_today: TODAY });
    expect(counts.data).toEqual([{ overdue: 0, due_today: 1, upcoming: 0 }]);
  });

  it("completing and reopening keeps the task", async () => {
    const client = await fullSessionClient(ownerEmail);
    const done = await client.from("tasks").update({ status: "completed" }).eq("id", taskId).select("status, completed_at").single();
    expect(done.data?.completed_at).toBeTruthy();
    const reopened = await client.from("tasks").update({ status: "open" }).eq("id", taskId).select("status, completed_at").single();
    expect(reopened.data).toEqual({ status: "open", completed_at: null });
  });

  it("logs an activity on the contact", async () => {
    const client = await fullSessionClient(ownerEmail);
    const { error } = await client.from("activities").insert({ contact_id: contactId, task_id: taskId, activity_type: "call", outcome: "left_message", notes: "Fictional" });
    expect(error).toBeNull();
  });

  it("the owner can set their name and review link, but only those profile fields", async () => {
    const client = await fullSessionClient(ownerEmail);
    const ok = await client.from("profiles").update({ display_name: "Test Agent", google_review_url: "https://g.page/r/fictional" }).eq("id", ownerId).select("display_name");
    expect(ok.data).toEqual([{ display_name: "Test Agent" }]);
    const bad = await client.from("profiles").update({ google_review_url: "http://not-https.example.com" }).eq("id", ownerId);
    expect(bad.error?.code).toBe("23514");
  });

  it("another account sees and changes nothing", async () => {
    const stranger = await createTestUser("tasks-stranger");
    const client = await fullSessionClient(stranger.email);
    expect((await client.rpc("search_tasks", { ...SEARCH, p_view: "today" })).data).toEqual([]);
    expect((await client.from("activities").select("id").eq("contact_id", contactId)).data).toEqual([]);
    expect((await client.from("tasks").update({ title: "x" }).eq("id", taskId).select("id")).data).toEqual([]);
    expect((await client.from("profiles").update({ display_name: "x" }).eq("id", ownerId).select("id")).data).toEqual([]);
    const sneaky = await client.from("tasks").insert({ contact_id: contactId, title: "x", due_date: TODAY });
    expect(sneaky.error).not.toBeNull();
  });

  it("anonymous and password-only callers get nothing", async () => {
    expect((await anonClient().rpc("task_counts", { p_today: TODAY })).error?.code).toBe("42501");
    const aal1 = anonClient();
    await aal1.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD });
    expect((await aal1.rpc("search_tasks", { ...SEARCH, p_view: "today" })).data).toEqual([]);
    expect((await aal1.from("activities").select("id")).data).toEqual([]);
  });
});
