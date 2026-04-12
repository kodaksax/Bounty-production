import { supabase } from '../supabase';
import { Bounty, BountyStatus } from '../types';

export class BountyService {
  static async updateBountyStatus(
    bountyId: string, 
    status: BountyStatus,
    metadata?: Record<string, any>
  ): Promise<Bounty> {
    try {
      console.log('Updating bounty status:', { bountyId, status, metadata });
      
      const updateData: any = {
        status,
        updated_at: new Date().toISOString()
      };

      if (metadata) {
        updateData.metadata = metadata;
      }

      const { data, error } = await supabase
        .from('bounties')
        .update(updateData)
        .eq('id', bountyId)
        .select('*')
        .single();

      if (error) {
        console.error('Error updating bounty status:', error);
        throw new Error(`Failed to update bounty status: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data returned from bounty update');
      }

      console.log('Bounty status updated successfully:', data);
      return data;
    } catch (error) {
      console.error('BountyService.updateBountyStatus error:', error);
      throw error;
    }
  }

  static async acceptBountyRequest(
    bountyId: string,
    requestId: string,
    acceptedUserId: string
  ): Promise<{ bounty: Bounty; request: any }> {
    try {
      console.log('Accepting bounty request:', { bountyId, requestId, acceptedUserId });

      // Start a transaction-like operation
      const { data: request, error: requestError } = await supabase
        .from('bounty_requests')
        .update({
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .eq('bounty_id', bountyId)
        .select('*')
        .single();

      if (requestError) {
        console.error('Error accepting bounty request:', requestError);
        throw new Error(`Failed to accept bounty request: ${requestError.message}`);
      }

      // Reject all other requests for this bounty
      await supabase
        .from('bounty_requests')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('bounty_id', bountyId)
        .neq('id', requestId);

      // Update bounty status to in_progress and assign user
      const updatedBounty = await this.updateBountyStatus(bountyId, 'in_progress', {
        assigned_user_id: acceptedUserId,
        request_accepted_at: new Date().toISOString()
      });

      console.log('Bounty request accepted successfully');
      return { bounty: updatedBounty, request };
    } catch (error) {
      console.error('BountyService.acceptBountyRequest error:', error);
      throw error;
    }
  }

  static async completeBounty(
    bountyId: string,
    completionData?: Record<string, any>
  ): Promise<Bounty> {
    try {
      console.log('Completing bounty:', { bountyId, completionData });

      const updatedBounty = await this.updateBountyStatus(bountyId, 'completed', {
        ...completionData,
        completed_at: new Date().toISOString()
      });

      console.log('Bounty completed successfully');
      return updatedBounty;
    } catch (error) {
      console.error('BountyService.completeBounty error:', error);
      throw error;
    }
  }

  static async getBountyWithDetails(bountyId: string): Promise<Bounty | null> {
    try {
      const { data, error } = await supabase
        .from('bounties')
        .select(`
          *,
          bounty_requests!inner(
            id,
            status,
            message,
            created_at,
            updated_at,
            user:user_id(
              id,
              full_name,
              avatar_url
            )
          ),
          creator:creator_id(
            id,
            full_name,
            avatar_url
          )
        `)
        .eq('id', bountyId)
        .single();

      if (error) {
        console.error('Error fetching bounty details:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('BountyService.getBountyWithDetails error:', error);
      return null;
    }
  }
}