import { expect, test } from "@playwright/test";
import { createTestUser, fullSessionClient, fullSessionCookies, ownStage } from "../support/supabase";

// Board fix after Phase 25 (owner, 2026-10-19): on a computer the board fits the window, so its
// sideways scrollbar is in view; Won shows the 5 most recent with a link to the rest; existing
// policies are not on the board. Fictional data only.
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:8787";

test("board fits a desktop window, caps the Won column and leaves existing policies off", async ({ page, context }) => {
  const owner = await createTestUser("e2e-board-layout");
  await context.addCookies(await fullSessionCookies(owner.email, APP_URL));
  const api = await fullSessionClient(owner.email);
  const bound = await ownStage(api, "auto", "bound");
  const { data: contacts } = await api.from("contacts")
    .insert(Array.from({ length: 8 }, (_, i) => ({ contact_type: "individual", first_name: `Won${i}`, last_name: "Example" })))
    .select("id, first_name");
  for (const c of contacts!.slice(0, 7)) await api.from("opportunities").insert({ contact_id: c.id, product_line: "auto", stage_id: bound, outcome: "won" });
  const held = contacts![7]!;
  await api.from("opportunities").insert({ contact_id: held.id, product_line: "auto", stage_id: bound, outcome: "won", existing_policy: true });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/opportunities?line=auto");
  const won = page.getByRole("region", { name: /Bound \(7\)/ });
  await expect(won.getByRole("listitem")).toHaveCount(5);
  await expect(won.getByRole("link", { name: "See all 7 in the table" })).toHaveAttribute("href", /view=table.*outcome=won/);
  await expect(page.getByText(`${held.first_name} Example`)).toHaveCount(0);

  // The board ends inside the window, so its horizontal scrollbar is visible without scrolling down.
  const box = await page.locator("section[aria-labelledby^=stage-]").first().locator("..").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
});
