import React, { useState } from 'react';
import { Trash2, MessageSquare, Archive } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

interface ChatActionsProps {
  isCompleted: boolean;
  onDeleteChat: () => void;
  onDeleteMessages: () => void;
  onArchiveChat: () => void;
  disabled?: boolean;
}

export const ChatActions: React.FC<ChatActionsProps> = ({
  isCompleted,
  onDeleteChat,
  onDeleteMessages,
  onArchiveChat,
  disabled = false
}) => {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleDeleteChat = async () => {
    setIsDeleting(true);
    try {
      await onDeleteChat();
      setShowDeleteModal(false);
    } catch (error) {
      console.error('Failed to delete chat:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClearMessages = async () => {
    setIsClearing(true);
    try {
      await onDeleteMessages();
      setShowClearModal(false);
    } catch (error) {
      console.error('Failed to clear messages:', error);
    } finally {
      setIsClearing(false);
    }
  };

  if (!isCompleted) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2 p-3 border-t border-gray-200 bg-gray-50">
        <span className="text-sm text-gray-600 mr-auto">
          Bounty completed - Chat actions available
        </span>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onArchiveChat}
          disabled={disabled}
          className="text-gray-600 hover:text-gray-800"
        >
          <Archive className="h-4 w-4 mr-1" />
          Archive
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowClearModal(true)}
          disabled={disabled}
          className="text-orange-600 hover:text-orange-800"
        >
          <MessageSquare className="h-4 w-4 mr-1" />
          Clear Messages
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDeleteModal(true)}
          disabled={disabled}
          className="text-red-600 hover:text-red-800"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Delete Chat
        </Button>
      </div>

      {/* Delete Chat Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Chat"
      >
        <div className="p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-900">Delete Chat</h3>
              <p className="text-sm text-gray-500">
                This action cannot be undone
              </p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-sm text-gray-700">
              Are you sure you want to delete this entire chat? This will permanently 
              remove all messages, attachments, and chat history. This action cannot be undone.
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteChat}
              loading={isDeleting}
            >
              Delete Chat
            </Button>
          </div>
        </div>
      </Modal>

      {/* Clear Messages Confirmation Modal */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Clear Messages"
      >
        <div className="p-6">
          <div className="flex items-center mb-4">
            <div className="flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                <MessageSquare className="h-5 w-5 text-orange-600" />
              </div>
            </div>
            <div className="ml-4">
              <h3 className="text-lg font-medium text-gray-900">Clear Messages</h3>
              <p className="text-sm text-gray-500">
                Remove all messages from this chat
              </p>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-sm text-gray-700">
              Are you sure you want to clear all messages in this chat? 
              This will remove all conversation history but keep the chat thread. 
              This action cannot be undone.
            </p>
          </div>

          <div className="flex justify-end space-x-3">
            <Button
              variant="outline"
              onClick={() => setShowClearModal(false)}
              disabled={isClearing}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handleClearMessages}
              loading={isClearing}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              Clear Messages
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};