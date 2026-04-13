import { supabase } from '../supabase';

type BountyStatus = 'open' | 'in_progress' | 'completed' | 'archived';

interface Bounty {
  id: string;
  status?: BountyStatus;
  updated_at?: string;
  hunter_id?: string;
  accepted_by?: string;
  accepted_request_id?: string;
  [key: string]: any;
}

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
        if (metadata.hunter_id !== undefined) {
          updateData.hunter_id = metadata.hunter_id;
        }

        if (metadata.accepted_by !== undefined) {
          updateData.accepted_by = metadata.accepted_by;
        }
      }

      const { data, error } = await supabase
        .from('bounties')
        .update(updateData)
        .eq('id', bountyId)
        .select()
        .single();

      if (error) {
        console.error('Supabase error updating bounty:', error);
        throw error;
      }

      console.log('Bounty updated successfully:', data);
      return data;
    } catch (error) {
      console.error('Error updating bounty status:', error);
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

      // First, update the specific request to accepted
      const { data: updatedRequest, error: requestError } = await supabase
        .from('bounty_requests')
        .update({ 
          status: 'accepted',
          updated_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .single();

      if (requestError) {
        console.error('Error updating bounty request:', requestError);
        throw requestError;
      }

      // Reject all other pending requests for this bounty
      const { error: rejectError } = await supabase
        .from('bounty_requests')
        .update({ 
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('bounty_id', bountyId)
        .neq('id', requestId)
        .in('status', ['pending', 'applied']);

      if (rejectError) {
        console.error('Error rejecting other requests:', rejectError);
        throw rejectError;
      }

      // Update bounty status to in_progress and persist the accepted hunter/request linkage
      const updatedBounty = await this.updateBountyStatus(bountyId, 'in_progress', {
        hunter_id: acceptedUserId,
        accepted_request_id: requestId
      });

      console.log('Bounty request accepted successfully');
      return {
        bounty: updatedBounty,
        request: updatedRequest
      };
    } catch (error) {
      console.error('Error accepting bounty request:', error);
      throw error;
    }
  }

  static async completeBounty(
    bountyId: string,
    completionData?: Record<string, any>
  ): Promise<Bounty> {
    try {
      console.log('Completing bounty:', { bountyId, completionData });

      const metadata = {
        completed_at: new Date().toISOString(),
        ...completionData
      };

      const updatedBounty = await this.updateBountyStatus(bountyId, 'completed', metadata);

      console.log('Bounty completed successfully');
      return updatedBounty;
    } catch (error) {
      console.error('Error completing bounty:', error);
      throw error;
    }
  }

  static async getBountyWithDetails(bountyId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('bounties')
        .select(`
          *,
          bounty_requests(
            *,
            user:hunter_id(*)
          ),
          creator:poster_id(*)
        `)
        .eq('id', bountyId)
        .single();

      if (error) {
        console.error('Error fetching bounty details:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error getting bounty with details:', error);
      throw error;
    }
  }
}