/**
 * Prompt template for plan execution
 */

export const EXECUTE_PLAN_PROMPT = `Execute the following implementation plan. Follow the Implementation Order section step by step.

As you complete each step:
- Check off completed items in the Implementation Order
- Update the Implementation Progress section with what was done
- If you encounter issues or need to deviate from the plan, note it in Implementation Progress
- Persist meaningful progress using \`update_plan\` with the latest full plan markdown body

**When finished:**
- Set \`status\` to \`completed\` using \`update_plan\`

**If stopping early:**
- Set \`status\` to \`cancelled\` (can resume later) or \`abandoned\` (won't continue) using \`update_plan\`
- Note the reason in Implementation Progress

Here is the plan:

`;
