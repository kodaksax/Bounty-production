import React, { useState, useEffect, useRef } from 'react';
import { Send, Trash2, MessageSquare, AlertTriangle } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useBountyStore } from '../../store/bountyStore';
import { Message, Chat } from '../../types/chat';

interface ChatInterfaceProps {
  chatId: string;
  bountyId?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ chatId, bountyId }) => {
  const [message, setMessage] = useState('');
  const [showDeleteMessageModal, setShowDeleteMessageModal] = useState<string | null>(null);
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    chats,
    messages,
    sendMessage,
    deleteMessage,
    deleteChat,
    loadMessages,
  } = useChatStore();

  const { bounties } = useBountyStore();

  const currentChat = chats.find(chat => chat.id === chatId);
  const chatMessages = messages[chatId] || [];
  const bounty = bountyId ? bounties.find(b => b.id === bountyId) : null;
  const isBountyCompleted = bounty?.status === 'completed';

  useEffect(() => {
    loadMessages(chatId);
  }, [chatId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    await sendMessage(chatId, message.trim());
    setMessage('');
  };

  const handleDeleteMessage = async (messageId: string) => {
    await deleteMessage(chatId, messageId);
    setShowDeleteMessageModal(null);
  };

  const handleDeleteChat = async () => {
    await deleteChat(chatId);
    setShowDeleteChatModal(false);
  };

  const formatTime = (timestamp: Date) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!currentChat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No chat selected</h3>
          <p className="mt-1 text-sm text-gray-500">Select a chat to start messaging</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{currentChat.title}</h2>
          {bounty && (
            <p className="text-sm text-gray-500">
              Bounty: {bounty.title} - 
              <span className={`ml-1 px-2 py-1 rounded-full text-xs font-medium ${
                isBountyCompleted 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {bounty.status}
              </span>
            </p>
          )}
        </div>
        
        {isBountyCompleted && (
          <button
            onClick={() => setShowDeleteChatModal(true)}
            className="flex items-center px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {chatMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.senderId === 'current-user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg relative group ${
                msg.senderId === 'current-user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <p className="text-sm">{msg.content}</p>
              <p
                className={`text-xs mt-1 ${
                  msg.senderId === 'current-user' ? 'text-blue-100' : 'text-gray-500'
                }`}
              >
                {formatTime(msg.timestamp)}
              </p>
              
              {isBountyCompleted && (
                <button
                  onClick={() => setShowDeleteMessageModal(msg.id)}
                  className={`absolute -top-2 -right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${
                    msg.senderId === 'current-user'
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-red-100 hover:bg-red-200 text-red-600'
                  }`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="px-6 py-4 border-t border-gray-200">
        <form onSubmit={handleSendMessage} className="flex space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={!message.trim()}
            className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Delete Message Modal */}
      {showDeleteMessageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-3" />
              <h3 className="text-lg font-medium text-gray-900">Delete Message</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete this message? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteMessageModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteMessage(showDeleteMessageModal)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Chat Modal */}
      {showDeleteChatModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <div className="flex items-center mb-4">
              <AlertTriangle className="h-6 w-6 text-red-600 mr-3" />
              <h3 className="text-lg font-medium text-gray-900">Delete Chat</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Are you sure you want to delete this entire chat? This will permanently remove all messages and cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteChatModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteChat}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;