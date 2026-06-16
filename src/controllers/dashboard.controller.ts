import { Request, Response } from "express";
import {
  DashboardFilters,
  DashboardOwnershipFilter,
  DashboardSortOption,
  getDashboardOverview,
  getDashboardStats,
  getRecentActivity,
  listDashboardDocuments,
} from "../services/dashboard.service";

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parseOwnership(value: unknown): DashboardOwnershipFilter {
  const ownership = firstQueryValue(value);
  if (ownership === "owned" || ownership === "shared") return ownership;
  return "all";
}

function parseSort(value: unknown): DashboardSortOption {
  const sort = firstQueryValue(value);
  const validSorts: DashboardSortOption[] = [
    "name_asc",
    "name_desc",
    "date_newest",
    "date_oldest",
    "size_asc",
    "size_desc",
    "type_asc",
  ];

  return validSorts.includes(sort as DashboardSortOption)
    ? (sort as DashboardSortOption)
    : "date_newest";
}

function parseFilters(req: Request): DashboardFilters {
  return {
    query: firstQueryValue(req.query.q),
    fileType: firstQueryValue(req.query.type),
    ownership: parseOwnership(req.query.ownership),
    sort: parseSort(req.query.sort),
  };
}

export class DashboardController {
  static async overview(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json(await getDashboardOverview(req.user!.id, parseFilters(req)));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async documents(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({
        documents: await listDashboardDocuments(req.user!.id, parseFilters(req)),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async stats(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({ stats: await getDashboardStats(req.user!.id) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async activity(req: Request, res: Response): Promise<void> {
    try {
      res.status(200).json({ activity: await getRecentActivity(req.user!.id) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
}
