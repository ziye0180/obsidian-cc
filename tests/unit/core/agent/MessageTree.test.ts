import { MessageTree } from '../../../../src/core/agent/MessageTree';
import type { ChatMessage } from '../../../../src/core/types/chat';

function msg(id: string, parentId: string | null = null, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content: `msg-${id}`, timestamp: Date.now(), parentId };
}

describe('MessageTree', () => {
  describe('fromLinearMessages', () => {
    it('should build a linear chain from flat messages', () => {
      const messages = [msg('1'), msg('2'), msg('3')];
      const tree = MessageTree.fromLinearMessages(messages);

      expect(tree.size).toBe(3);

      const m1 = tree.getMessage('1');
      expect(m1?.parentId).toBeNull();

      const m2 = tree.getMessage('2');
      expect(m2?.parentId).toBe('1');

      const m3 = tree.getMessage('3');
      expect(m3?.parentId).toBe('2');
    });

    it('should return all messages in order via getActivePath', () => {
      const messages = [msg('1'), msg('2'), msg('3')];
      const tree = MessageTree.fromLinearMessages(messages);

      const path = tree.getActivePath();
      expect(path.map(m => m.id)).toEqual(['1', '2', '3']);
    });

    it('should handle empty messages', () => {
      const tree = MessageTree.fromLinearMessages([]);
      expect(tree.size).toBe(0);
      expect(tree.getActivePath()).toEqual([]);
    });

    it('should handle single message', () => {
      const tree = MessageTree.fromLinearMessages([msg('1')]);
      expect(tree.size).toBe(1);
      const path = tree.getActivePath();
      expect(path.map(m => m.id)).toEqual(['1']);
    });
  });

  describe('fromMessages (with parentId)', () => {
    it('should build tree from messages with parentId', () => {
      const messages = [
        msg('1', null),
        msg('2', '1'),
        msg('3', '2'),
      ];
      const tree = MessageTree.fromMessages(messages);

      const path = tree.getActivePath();
      expect(path.map(m => m.id)).toEqual(['1', '2', '3']);
    });

    it('should handle branching', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
        msg('3a', '2a'),
      ];
      const tree = MessageTree.fromMessages(messages);

      // Default path follows first child
      const defaultPath = tree.getActivePath();
      expect(defaultPath.map(m => m.id)).toEqual(['1', '2a', '3a']);

      // Get path to 2b
      const branchPath = tree.getActivePath('2b');
      expect(branchPath.map(m => m.id)).toEqual(['1', '2b']);
    });
  });

  describe('addMessage', () => {
    it('should add a message to the tree', () => {
      const tree = MessageTree.fromLinearMessages([msg('1')]);
      tree.addMessage(msg('2', '1'));

      expect(tree.size).toBe(2);
      const path = tree.getActivePath('2');
      expect(path.map(m => m.id)).toEqual(['1', '2']);
    });

    it('should add root message', () => {
      const tree = MessageTree.fromMessages([]);
      tree.addMessage(msg('1', null));

      expect(tree.size).toBe(1);
      const path = tree.getActivePath();
      expect(path.map(m => m.id)).toEqual(['1']);
    });
  });

  describe('getBranchInfo', () => {
    it('should return branch info for a non-branching message', () => {
      const tree = MessageTree.fromLinearMessages([msg('1'), msg('2'), msg('3')]);
      const info = tree.getBranchInfo('2');

      expect(info).not.toBeNull();
      expect(info!.currentIndex).toBe(1);
      expect(info!.totalBranches).toBe(1);
      expect(info!.parentId).toBe('1');
    });

    it('should return branch info for branching messages', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
        msg('2c', '1'),
      ];
      const tree = MessageTree.fromMessages(messages);

      const infoA = tree.getBranchInfo('2a');
      expect(infoA!.currentIndex).toBe(1);
      expect(infoA!.totalBranches).toBe(3);
      expect(infoA!.siblingIds).toEqual(['2a', '2b', '2c']);

      const infoC = tree.getBranchInfo('2c');
      expect(infoC!.currentIndex).toBe(3);
      expect(infoC!.totalBranches).toBe(3);
    });

    it('should return null for unknown message', () => {
      const tree = MessageTree.fromMessages([]);
      expect(tree.getBranchInfo('unknown')).toBeNull();
    });
  });

  describe('switchBranch', () => {
    it('should switch to next sibling', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
        msg('3a', '2a'),
        msg('3b', '2b'),
      ];
      const tree = MessageTree.fromMessages(messages);

      const newLeaf = tree.switchBranch('2a', 'next');
      expect(newLeaf).toBe('3b');
    });

    it('should switch to prev sibling', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
      ];
      const tree = MessageTree.fromMessages(messages);

      const newLeaf = tree.switchBranch('2b', 'prev');
      expect(newLeaf).toBe('2a');
    });

    it('should wrap around when switching past boundaries', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
      ];
      const tree = MessageTree.fromMessages(messages);

      // Next from last wraps to first
      const newLeaf = tree.switchBranch('2b', 'next');
      expect(newLeaf).toBe('2a');
    });

    it('should return null for non-branching message', () => {
      const tree = MessageTree.fromLinearMessages([msg('1'), msg('2')]);
      expect(tree.switchBranch('2', 'next')).toBeNull();
    });
  });

  describe('editAndFork', () => {
    it('should create a new branch from an existing message', () => {
      const messages = [
        msg('1', null),
        msg('2', '1'),
        msg('3', '2'),
      ];
      const tree = MessageTree.fromMessages(messages);

      const result = tree.editAndFork('2', 'edited content', 'new-2');

      expect(result).not.toBeNull();
      expect(result!.newMessageId).toBe('new-2');

      // New message should be sibling of '2'
      const info = tree.getBranchInfo('new-2');
      expect(info!.totalBranches).toBe(2);
      expect(info!.siblingIds).toEqual(['2', 'new-2']);

      // Active path from new message should not include '3'
      const path = tree.getActivePath('new-2');
      expect(path.map(m => m.id)).toEqual(['1', 'new-2']);
    });

    it('should return null for unknown message', () => {
      const tree = MessageTree.fromMessages([]);
      expect(tree.editAndFork('unknown', 'content', 'new')).toBeNull();
    });
  });

  describe('getAllMessages', () => {
    it('should return all messages in the tree', () => {
      const messages = [
        msg('1', null),
        msg('2a', '1'),
        msg('2b', '1'),
      ];
      const tree = MessageTree.fromMessages(messages);
      expect(tree.getAllMessages()).toHaveLength(3);
    });
  });
});
