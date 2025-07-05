import {
  users,
  tasks,
  projects,
  workspaces,
  taskShares,
  workspaceMembers,
  taskTemplates,
  userAchievements,
  userStats,
  pomodoroSessions,
  type User,
  type UpsertUser,
  type Task,
  type InsertTask,
  type Project,
  type InsertProject,
  type Workspace,
  type InsertWorkspace,
  type TaskShare,
  type InsertTaskShare,
  type TaskTemplate,
  type InsertTaskTemplate,
  type UserAchievement,
  type UserStats,
  type PomodoroSession,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, or, count, sum, gte, lte, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Task operations
  getTasks(userId: string, filters?: TaskFilters): Promise<Task[]>;
  getTask(id: number, userId: string): Promise<Task | undefined>;
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, userId: string, updates: Partial<InsertTask>): Promise<Task>;
  deleteTask(id: number, userId: string): Promise<boolean>;
  getSharedTasks(userId: string): Promise<Task[]>;

  // Project operations
  getProjects(userId: string): Promise<Project[]>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, userId: string, updates: Partial<InsertProject>): Promise<Project>;
  deleteProject(id: number, userId: string): Promise<boolean>;

  // Workspace operations
  getWorkspaces(userId: string): Promise<Workspace[]>;
  createWorkspace(workspace: InsertWorkspace): Promise<Workspace>;
  updateWorkspace(id: number, userId: string, updates: Partial<InsertWorkspace>): Promise<Workspace>;
  deleteWorkspace(id: number, userId: string): Promise<boolean>;
  addWorkspaceMember(workspaceId: number, userId: string, role?: string): Promise<void>;

  // Task sharing operations
  shareTask(taskShare: InsertTaskShare): Promise<TaskShare>;
  getTaskShares(taskId: number): Promise<TaskShare[]>;
  removeTaskShare(taskId: number, userId: string): Promise<boolean>;

  // Template operations
  getTaskTemplates(userId: string): Promise<TaskTemplate[]>;
  createTaskTemplate(template: InsertTaskTemplate): Promise<TaskTemplate>;

  // Analytics operations
  getUserStats(userId: string): Promise<UserStats | undefined>;
  updateUserStats(userId: string, updates: Partial<UserStats>): Promise<UserStats>;
  getTaskStats(userId: string, dateRange?: DateRange): Promise<TaskStatistics>;

  // Gamification operations
  getUserAchievements(userId: string): Promise<UserAchievement[]>;
  addUserAchievement(userId: string, achievementType: string, data?: any): Promise<UserAchievement>;

  // Pomodoro operations
  addPomodoroSession(userId: string, taskId: number | null, duration: number): Promise<PomodoroSession>;
  getPomodoroSessions(userId: string, dateRange?: DateRange): Promise<PomodoroSession[]>;
}

export interface TaskFilters {
  status?: string;
  priority?: string;
  projectId?: number;
  workspaceId?: number;
  dueDate?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TaskStatistics {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  completionRate: number;
  averageCompletionTime: number;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Task operations
  async getTasks(userId: string, filters?: TaskFilters): Promise<Task[]> {
    let query = db.select().from(tasks).where(eq(tasks.userId, userId));

    if (filters?.status) {
      query = query.where(eq(tasks.status, filters.status as any));
    }

    if (filters?.priority) {
      query = query.where(eq(tasks.priority, filters.priority as any));
    }

    if (filters?.projectId) {
      query = query.where(eq(tasks.projectId, filters.projectId));
    }

    if (filters?.workspaceId) {
      query = query.where(eq(tasks.workspaceId, filters.workspaceId));
    }

    if (filters?.dueDate) {
      const date = new Date(filters.dueDate);
      const nextDay = new Date(date);
      nextDay.setDate(date.getDate() + 1);
      query = query.where(and(
        gte(tasks.dueDate, date),
        lte(tasks.dueDate, nextDay)
      ));
    }

    if (filters?.search) {
      query = query.where(
        or(
          sql`${tasks.title} ILIKE ${`%${filters.search}%`}`,
          sql`${tasks.description} ILIKE ${`%${filters.search}%`}`
        )
      );
    }

    // Sorting
    const sortBy = filters?.sortBy || 'createdAt';
    const sortOrder = filters?.sortOrder || 'desc';
    
    if (sortBy === 'dueDate') {
      query = sortOrder === 'asc' ? query.orderBy(asc(tasks.dueDate)) : query.orderBy(desc(tasks.dueDate));
    } else if (sortBy === 'priority') {
      query = sortOrder === 'asc' ? query.orderBy(asc(tasks.priority)) : query.orderBy(desc(tasks.priority));
    } else {
      query = sortOrder === 'asc' ? query.orderBy(asc(tasks.createdAt)) : query.orderBy(desc(tasks.createdAt));
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    if (filters?.offset) {
      query = query.offset(filters.offset);
    }

    return await query;
  }

  async getTask(id: number, userId: string): Promise<Task | undefined> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return task;
  }

  async createTask(task: InsertTask): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    return newTask;
  }

  async updateTask(id: number, userId: string, updates: Partial<InsertTask>): Promise<Task> {
    const [updatedTask] = await db
      .update(tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
      .returning();
    return updatedTask;
  }

  async deleteTask(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
    return result.rowCount > 0;
  }

  async getSharedTasks(userId: string): Promise<Task[]> {
    const sharedTasks = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        priority: tasks.priority,
        status: tasks.status,
        dueDate: tasks.dueDate,
        estimatedHours: tasks.estimatedHours,
        progress: tasks.progress,
        userId: tasks.userId,
        projectId: tasks.projectId,
        workspaceId: tasks.workspaceId,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .innerJoin(taskShares, eq(tasks.id, taskShares.taskId))
      .where(eq(taskShares.userId, userId));

    return sharedTasks;
  }

  // Project operations
  async getProjects(userId: string): Promise<Project[]> {
    return await db.select().from(projects).where(eq(projects.ownerId, userId));
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
    return newProject;
  }

  async updateProject(id: number, userId: string, updates: Partial<InsertProject>): Promise<Project> {
    const [updatedProject] = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, id), eq(projects.ownerId, userId)))
      .returning();
    return updatedProject;
  }

  async deleteProject(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.ownerId, userId)));
    return result.rowCount > 0;
  }

  // Workspace operations
  async getWorkspaces(userId: string): Promise<Workspace[]> {
    const ownedWorkspaces = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId));

    const memberWorkspaces = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        color: workspaces.color,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .innerJoin(workspaceMembers, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, userId));

    return [...ownedWorkspaces, ...memberWorkspaces];
  }

  async createWorkspace(workspace: InsertWorkspace): Promise<Workspace> {
    const [newWorkspace] = await db.insert(workspaces).values(workspace).returning();
    return newWorkspace;
  }

  async updateWorkspace(id: number, userId: string, updates: Partial<InsertWorkspace>): Promise<Workspace> {
    const [updatedWorkspace] = await db
      .update(workspaces)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)))
      .returning();
    return updatedWorkspace;
  }

  async deleteWorkspace(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.ownerId, userId)));
    return result.rowCount > 0;
  }

  async addWorkspaceMember(workspaceId: number, userId: string, role = 'member'): Promise<void> {
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId,
      role,
    });
  }

  // Task sharing operations
  async shareTask(taskShare: InsertTaskShare): Promise<TaskShare> {
    const [newTaskShare] = await db.insert(taskShares).values(taskShare).returning();
    return newTaskShare;
  }

  async getTaskShares(taskId: number): Promise<TaskShare[]> {
    return await db.select().from(taskShares).where(eq(taskShares.taskId, taskId));
  }

  async removeTaskShare(taskId: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(taskShares)
      .where(and(eq(taskShares.taskId, taskId), eq(taskShares.userId, userId)));
    return result.rowCount > 0;
  }

  // Template operations
  async getTaskTemplates(userId: string): Promise<TaskTemplate[]> {
    return await db.select().from(taskTemplates).where(eq(taskTemplates.userId, userId));
  }

  async createTaskTemplate(template: InsertTaskTemplate): Promise<TaskTemplate> {
    const [newTemplate] = await db.insert(taskTemplates).values(template).returning();
    return newTemplate;
  }

  // Analytics operations
  async getUserStats(userId: string): Promise<UserStats | undefined> {
    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, userId));
    return stats;
  }

  async updateUserStats(userId: string, updates: Partial<UserStats>): Promise<UserStats> {
    const [updatedStats] = await db
      .insert(userStats)
      .values({ userId, ...updates })
      .onConflictDoUpdate({
        target: userStats.userId,
        set: { ...updates, updatedAt: new Date() },
      })
      .returning();
    return updatedStats;
  }

  async getTaskStats(userId: string, dateRange?: DateRange): Promise<TaskStatistics> {
    let query = db.select().from(tasks).where(eq(tasks.userId, userId));

    if (dateRange) {
      query = query.where(and(
        gte(tasks.createdAt, dateRange.start),
        lte(tasks.createdAt, dateRange.end)
      ));
    }

    const taskList = await query;

    const totalTasks = taskList.length;
    const completedTasks = taskList.filter(task => task.status === 'completed').length;
    const inProgressTasks = taskList.filter(task => task.status === 'in_progress').length;
    const overdueTasks = taskList.filter(task => 
      task.dueDate && task.dueDate < new Date() && task.status !== 'completed'
    ).length;

    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    return {
      totalTasks,
      completedTasks,
      inProgressTasks,
      overdueTasks,
      completionRate,
      averageCompletionTime: 0, // Would need to calculate based on task completion history
    };
  }

  // Gamification operations
  async getUserAchievements(userId: string): Promise<UserAchievement[]> {
    return await db.select().from(userAchievements).where(eq(userAchievements.userId, userId));
  }

  async addUserAchievement(userId: string, achievementType: string, data?: any): Promise<UserAchievement> {
    const [achievement] = await db.insert(userAchievements).values({
      userId,
      achievementType,
      achievementData: data,
    }).returning();
    return achievement;
  }

  // Pomodoro operations
  async addPomodoroSession(userId: string, taskId: number | null, duration: number): Promise<PomodoroSession> {
    const [session] = await db.insert(pomodoroSessions).values({
      userId,
      taskId,
      duration,
    }).returning();
    return session;
  }

  async getPomodoroSessions(userId: string, dateRange?: DateRange): Promise<PomodoroSession[]> {
    let query = db.select().from(pomodoroSessions).where(eq(pomodoroSessions.userId, userId));

    if (dateRange) {
      query = query.where(and(
        gte(pomodoroSessions.completedAt, dateRange.start),
        lte(pomodoroSessions.completedAt, dateRange.end)
      ));
    }

    return await query;
  }
}

export const storage = new DatabaseStorage();
