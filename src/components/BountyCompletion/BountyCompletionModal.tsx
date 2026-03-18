import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, CheckCircle } from 'lucide-react';

interface BountyCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (deleteChat: boolean) => void;
  bountyTitle: string;
}

export function BountyCompletionModal({
  isOpen,
  onClose,
  onComplete,
  bountyTitle,
}: BountyCompletionModalProps) {
  const [deleteChat, setDeleteChat] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleComplete = () => {
    if (deleteChat) {
      setShowConfirmation(true);
    } else {
      onComplete(false);
    }
  };

  const handleConfirmedComplete = () => {
    setShowConfirmation(false);
    onComplete(deleteChat);
    setDeleteChat(false);
  };

  const handleCancel = () => {
    setDeleteChat(false);
    onClose();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleCancel}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Complete Bounty
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You're about to mark the bounty "{bountyTitle}" as complete.
            </p>
            
            <div className="flex items-center space-x-2">
              <Checkbox
                id="delete-chat"
                checked={deleteChat}
                onCheckedChange={(checked) => setDeleteChat(checked as boolean)}
              />
              <Label 
                htmlFor="delete-chat" 
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete chat messages after completion
              </Label>
            </div>
            
            {deleteChat && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-xs text-yellow-800">
                  ⚠️ This action cannot be undone. All chat messages and conversation history will be permanently deleted.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleComplete}>
              Complete Bounty
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Chat Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to complete this bounty and delete all chat messages? 
              This action cannot be undone and all conversation history will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowConfirmation(false)}>
              Keep Chat
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmedComplete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Chat & Complete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}