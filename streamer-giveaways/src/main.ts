// npm start -- "viewer42 in chat: can I get a code from camp-spring?"
// OPERATOR_CONSOLE=1 npm start -- "export camp-spring"   (the operator's console, with the export tool)
import { operatorTools, reply } from "./agent.ts";

const toolset = process.env.OPERATOR_CONSOLE === "1" ? operatorTools : undefined;
console.log(await reply(process.argv.slice(2).join(" "), undefined, toolset));
