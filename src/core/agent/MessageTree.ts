/**
 * Tree data structure for conversation branching.
 *
 * Manages parent-child message relationships and active branch tracking.
 * Pure data operations — no DOM or side effects.
 */

import type { BranchInfo, ForkResult } from '../types/branch';
import type { ChatMessage } from '../types/chat';

export class MessageTree {
  private messages: Map<string, ChatMessage> = new Map();
  private rootIds: string[] = [];

  private constructor() {}

  /** Build tree from messages that already have parentId set. */
  static fromMessages(messages: ChatMessage[]): MessageTree {
    const tree = new MessageTree();
    for (const msg of messages) {
      tree.messages.set(msg.id, { ...msg, childIds: [] });
    }
    tree.buildChildLinks();
    return tree;
  }

  /** Migrate linear (flat) messages into a tree with implicit parent chain. */
  static fromLinearMessages(messages: ChatMessage[]): MessageTree {
    const tree = new MessageTree();
    for (let i = 0; i < messages.length; i++) {
      const msg = { ...messages[i], childIds: [] as string[] };
      msg.parentId = i > 0 ? messages[i - 1].id : null;
      tree.messages.set(msg.id, msg);
    }
    tree.buildChildLinks();
    return tree;
  }

  private buildChildLinks(): void {
    this.rootIds = [];
    // Reset childIds
    for (const msg of this.messages.values()) {
      msg.childIds = [];
    }
    for (const msg of this.messages.values()) {
      if (msg.parentId == null) {
        this.rootIds.push(msg.id);
      } else {
        const parent = this.messages.get(msg.parentId);
        if (parent) {
          parent.childIds!.push(msg.id);
        } else {
          // Orphan — treat as root
          this.rootIds.push(msg.id);
        }
      }
    }
  }

  /** Add a message to the tree. */
  addMessage(msg: ChatMessage): void {
    const copy = { ...msg, childIds: [] as string[] };
    this.messages.set(copy.id, copy);
    if (copy.parentId == null) {
      this.rootIds.push(copy.id);
    } else {
      const parent = this.messages.get(copy.parentId);
      if (parent) {
        parent.childIds!.push(copy.id);
      } else {
        this.rootIds.push(copy.id);
      }
    }
  }

  /** Get ordered messages along the active branch. */
  getActivePath(activeLeafId?: string | null): ChatMessage[] {
    if (this.messages.size === 0) return [];

    // Find the leaf to trace back from
    const leafId = activeLeafId ?? this.findDefaultLeaf();
    if (!leafId) return [];

    // Trace from leaf to root
    const pathIds: string[] = [];
    let currentId: string | null | undefined = leafId;
    while (currentId) {
      pathIds.push(currentId);
      const msg = this.messages.get(currentId);
      currentId = msg?.parentId;
    }

    // Reverse to get root-first order
    pathIds.reverse();
    return pathIds
      .map(id => this.messages.get(id))
      .filter((m): m is ChatMessage => m !== undefined);
  }

  /** Find the default leaf: follow first child from first root. */
  private findDefaultLeaf(): string | null {
    if (this.rootIds.length === 0) return null;
    let id = this.rootIds[0];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const msg = this.messages.get(id);
      if (!msg || !msg.childIds || msg.childIds.length === 0) return id;
      id = msg.childIds[0];
    }
  }

  /** Switch to prev/next sibling branch at a given message. Returns the new active leaf. */
  switchBranch(messageId: string, direction: 'prev' | 'next'): string | null {
    const msg = this.messages.get(messageId);
    if (!msg) return null;

    const siblings = this.getSiblingIds(messageId);
    if (siblings.length <= 1) return null;

    const currentIdx = siblings.indexOf(messageId);
    const newIdx = direction === 'prev'
      ? (currentIdx - 1 + siblings.length) % siblings.length
      : (currentIdx + 1) % siblings.length;

    const newMsgId = siblings[newIdx];

    // Follow new branch to its default leaf
    let leafId = newMsgId;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const node = this.messages.get(leafId);
      if (!node || !node.childIds || node.childIds.length === 0) break;
      leafId = node.childIds[0];
    }

    return leafId;
  }

  /** Create a fork: add a new message as a sibling to the given message. */
  editAndFork(messageId: string, newContent: string, newId: string): ForkResult | null {
    const original = this.messages.get(messageId);
    if (!original) return null;

    const newMsg: ChatMessage = {
      id: newId,
      role: original.role,
      content: newContent,
      timestamp: Date.now(),
      parentId: original.parentId,
      childIds: [],
    };

    this.addMessage(newMsg);

    const siblings = this.getSiblingIds(newId);
    const branchInfo: BranchInfo = {
      currentIndex: siblings.indexOf(newId) + 1,
      totalBranches: siblings.length,
      messageId: newId,
      parentId: newMsg.parentId ?? null,
      siblingIds: siblings,
    };

    return {
      newMessageId: newId,
      activePath: {
        messageIds: this.getActivePath(newId).map(m => m.id),
        leafId: newId,
      },
      branchInfo,
    };
  }

  /** Get branch info for a message. */
  getBranchInfo(messageId: string): BranchInfo | null {
    const msg = this.messages.get(messageId);
    if (!msg) return null;

    const siblings = this.getSiblingIds(messageId);

    return {
      currentIndex: siblings.indexOf(messageId) + 1,
      totalBranches: siblings.length,
      messageId,
      parentId: msg.parentId ?? null,
      siblingIds: siblings,
    };
  }

  /** Get all sibling IDs (including self) for a message. */
  private getSiblingIds(messageId: string): string[] {
    const msg = this.messages.get(messageId);
    if (!msg) return [messageId];

    if (msg.parentId == null) {
      return this.rootIds;
    }

    const parent = this.messages.get(msg.parentId);
    return parent?.childIds ?? [messageId];
  }

  /** Get all messages in the tree. */
  getAllMessages(): ChatMessage[] {
    return Array.from(this.messages.values());
  }

  /** Get a single message by ID. */
  getMessage(id: string): ChatMessage | undefined {
    return this.messages.get(id);
  }

  /** Get the total number of messages. */
  get size(): number {
    return this.messages.size;
  }
}
