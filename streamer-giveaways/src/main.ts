// npm start -- "viewer42 in chat: can I get a code from campaign id camp-spring?"
import { reply } from "./agent.ts";

const message = process.argv.slice(2).join(" ") || "viewer1 in chat: can I get a code from campaign id camp-spring?";
console.log(await reply(message));
