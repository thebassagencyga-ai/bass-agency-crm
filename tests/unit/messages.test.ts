import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/lib/dates";
import { mailtoHref, smsHref, telHref } from "@/lib/messages/links";
import {
  fillTemplate, isTemplateKey, renderTemplate, TEMPLATE_KEYS, TEMPLATES, templateForOpportunity, templateForTaskCategory, valuesFor,
} from "@/lib/messages/templates";

const none = { first_name: null, agent_name: null, line: null, renewal_date: null };

describe("templates", () => {
  it("fill names, line and date, with neutral words when missing", () => {
    const values = valuesFor({ first_name: "Robin" }, "Sam Example", { product_line: "auto", outcome: "won", renewal_date: "2027-03-01", current_policy_renews_on: null }, formatDateOnly);
    expect(renderTemplate("renewal", values)).toEqual({
      subject: "Your auto policy renews on Mar 1, 2027",
      body: "Hi Robin, this is Sam Example. Your auto policy renews on Mar 1, 2027. I'd like to do a quick review to make sure your coverage still fits. When is a good time to talk?",
    });
    expect(renderTemplate("renewal", none).body).toBe(
      "Hi there, this is The Bass Agency. Your insurance policy renews soon. I'd like to do a quick review to make sure your coverage still fits. When is a good time to talk?");
    expect(fillTemplate("{first_name} {unknown}", { ...none, first_name: "  " })).toBe("there {unknown}");
  });

  it("a prospect's date is their current policy's renewal; commercial reads as business", () => {
    const v = valuesFor({ first_name: null }, null, { product_line: "commercial", outcome: "open", renewal_date: null, current_policy_renews_on: "2026-12-15" }, formatDateOnly);
    expect(v).toMatchObject({ line: "business", renewal_date: "on Dec 15, 2026" });
  });

  it("no template leaves a placeholder unfilled", () => {
    for (const key of TEMPLATE_KEYS) {
      const { subject, body } = renderTemplate(key, none);
      expect(`${subject} ${body}`).not.toMatch(/[{}]/);
      expect(TEMPLATES[key].label).not.toBe("");
    }
  });

  it("picks a sensible starting template", () => {
    const opp = { outcome: "open", renewal_date: null, quote_sent_on: null, current_policy_renews_on: null };
    expect(templateForOpportunity(opp)).toBe("checkin");
    expect(templateForOpportunity({ ...opp, quote_sent_on: "2026-10-01" })).toBe("quote_follow_up");
    expect(templateForOpportunity({ ...opp, current_policy_renews_on: "2026-12-01" })).toBe("xdate");
    expect(templateForOpportunity({ ...opp, outcome: "won", renewal_date: "2027-01-01" })).toBe("renewal");
    expect(templateForOpportunity({ ...opp, outcome: "won" })).toBe("thank_you");
    expect(templateForOpportunity({ ...opp, outcome: "lost", quote_sent_on: "2026-10-01" })).toBe("checkin");
    expect(templateForTaskCategory("renewal")).toBe("renewal");
    expect(templateForTaskCategory("prospecting")).toBe("quote_follow_up");
    expect(templateForTaskCategory("other")).toBe("checkin");
    expect(isTemplateKey("renewal")).toBe(true);
    expect(isTemplateKey("toString")).toBe(false);
    expect(isTemplateKey(undefined)).toBe(false);
  });
});

describe("device links", () => {
  it("mailto: encodes subject and body (spaces as %20, CRLF line breaks)", () => {
    expect(mailtoHref("robin@example.com", "Your auto quote", "Hi Robin & co,\nthanks? 100%")).toBe(
      "mailto:robin@example.com?subject=Your%20auto%20quote&body=Hi%20Robin%20%26%20co%2C%0D%0Athanks%3F%20100%25");
    expect(mailtoHref(" robin+home@example.com ", "", "")).toBe("mailto:robin+home@example.com");
  });

  it.each([null, "", "not-an-email", "a@example.com?bcc=x@example.com", "a@example.com&cc=b", "two words@example.com"])(
    "mailto: refuses %s", (email) => expect(mailtoHref(email, "s", "b")).toBeNull());

  it("sms: and tel: need a 10-digit US number", () => {
    expect(smsHref("(404) 555-0101", "Hi there")).toBe("sms:+14045550101?&body=Hi%20there");
    expect(telHref("1-404-555-0101")).toBe("tel:+14045550101");
    expect(telHref("555-0101")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
