// What every report script shares: a sentence said to the person, and a main function that prints it without a stack.

/** Said to the person, then the script stops. */
export class UsageError extends Error {}

/** Run a script's main function; a UsageError (or any error with a plain message) is printed without a stack. */
export async function main(run: () => Promise<number | void>): Promise<void> {
  try {
    process.exitCode = (await run()) ?? 0;
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = e instanceof UsageError ? 64 : 1;
  }
}
