/**
 * Branch and tree types for conversation branching.
 */

/** Position info for a message within a branch. */
export interface BranchInfo {
  currentIndex: number;
  totalBranches: number;
  messageId: string;
  parentId: string | null;
  siblingIds: string[];
}

/** Result of editing a message and forking a new branch. */
export interface ForkResult {
  newMessageId: string;
  activePath: ActivePath;
  branchInfo: BranchInfo;
}

/** Ordered list of message IDs on the current active branch. */
export interface ActivePath {
  messageIds: string[];
  leafId: string | null;
}
