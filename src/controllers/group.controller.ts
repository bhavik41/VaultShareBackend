import { Request, Response } from 'express'
import * as groupService from '../services/group.service'

function getErrorStatus(message: string): number {
  if (message === 'Access denied.') return 403
  if (message.includes('not found')) return 404
  if (message.includes('already')) return 409
  return 400
}

export class GroupController {
  // ── Groups ──────────────────────────────────────────────────────────────────

  static async createGroup(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, defaultRole } = req.body
      if (!name) {
        res.status(400).json({ message: 'name is required.' })
        return
      }
      const group = await groupService.createNewGroup(req.user!.id, name, description, defaultRole ?? 'viewer')
      res.status(201).json({ message: 'Group created.', group })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async listMyGroups(req: Request, res: Response): Promise<void> {
    try {
      const groups = await groupService.listMyGroups(req.user!.id)
      res.status(200).json({ groups })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  static async getGroup(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const group = await groupService.getGroupDetails(groupId, req.user!.id)
      res.status(200).json({ group })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async updateGroup(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const { name, description, defaultRole } = req.body
      const group = await groupService.updateGroupDetails(groupId, req.user!.id, { name, description, defaultRole })
      res.status(200).json({ message: 'Group updated.', group })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async deleteGroup(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      await groupService.deleteGroupById(groupId, req.user!.id)
      res.status(200).json({ message: 'Group deleted.' })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  // ── Members ─────────────────────────────────────────────────────────────────

  static async addMember(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const { email, role } = req.body
      if (!email || !role) {
        res.status(400).json({ message: 'email and role are required.' })
        return
      }
      const invitation = await groupService.addMemberToGroup(groupId, req.user!.id, email, role)
      res.status(201).json({ message: 'Invitation sent.', invitation })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async listMembers(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const members = await groupService.listGroupMembers(groupId, req.user!.id)
      res.status(200).json({ members })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async updateMemberRole(req: Request, res: Response): Promise<void> {
    try {
      const { groupId, userId } = req.params
      const { role } = req.body
      if (!role) {
        res.status(400).json({ message: 'role is required.' })
        return
      }
      const member = await groupService.updateMemberRole(groupId, req.user!.id, userId, role)
      res.status(200).json({ message: 'Member role updated.', member })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async removeMember(req: Request, res: Response): Promise<void> {
    try {
      const { groupId, userId } = req.params
      await groupService.removeMemberFromGroup(groupId, req.user!.id, userId)
      res.status(200).json({ message: 'Member removed.' })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  // ── Invitations ─────────────────────────────────────────────────────────────

  static async getMyInvitations(req: Request, res: Response): Promise<void> {
    try {
      const invitations = await groupService.getMyInvitations(req.user!.id)
      res.status(200).json({ invitations })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  static async respondToInvitation(req: Request, res: Response): Promise<void> {
    try {
      const { invitationId } = req.params
      const { accept } = req.body
      if (typeof accept !== 'boolean') {
        res.status(400).json({ message: 'accept (boolean) is required.' })
        return
      }
      await groupService.respondToGroupInvitation(invitationId, req.user!.id, accept)
      res.status(200).json({ message: accept ? 'Invitation accepted. You are now a member.' : 'Invitation rejected.' })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  // ── File Sharing ─────────────────────────────────────────────────────────────

  static async shareFile(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const { fileId, role } = req.body
      if (!fileId || !role) {
        res.status(400).json({ message: 'fileId and role are required.' })
        return
      }
      const share = await groupService.shareFileWithGroup(groupId, fileId, req.user!.id, role)
      res.status(201).json({ message: 'File shared with group. Members notified via email.', share })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async listGroupFiles(req: Request, res: Response): Promise<void> {
    try {
      const { groupId } = req.params
      const files = await groupService.listGroupFiles(groupId, req.user!.id)
      res.status(200).json({ files })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async updateFilePermission(req: Request, res: Response): Promise<void> {
    try {
      const { groupId, fileId } = req.params
      const { role } = req.body
      if (!role) {
        res.status(400).json({ message: 'role is required.' })
        return
      }
      const share = await groupService.updateGroupFilePermission(groupId, fileId, req.user!.id, role)
      res.status(200).json({ message: 'File permission updated.', share })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async removeFile(req: Request, res: Response): Promise<void> {
    try {
      const { groupId, fileId } = req.params
      await groupService.removeFileFromGroup(groupId, fileId, req.user!.id)
      res.status(200).json({ message: 'File removed from group.' })
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message })
    }
  }

  static async getMyGroupFiles(req: Request, res: Response): Promise<void> {
    try {
      const files = await groupService.getFilesSharedWithUserViaGroups(req.user!.id)
      res.status(200).json({ files })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }
}
