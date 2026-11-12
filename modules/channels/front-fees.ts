// Item 11h: the public front's routes for a Fees centre (written next).
import type { FrontKit, RouteArgs } from "./front.ts";

export async function feeRoute(kit: FrontKit, a: RouteArgs): Promise<void> {
  return kit.sendHtml(a.res, 404, "<!doctype html><p>There is nothing here.</p>");
}
