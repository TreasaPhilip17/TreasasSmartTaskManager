import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { 
  insertTaskSchema, 
  insertProjectSchema, 
  insertWorkspaceSchema,
  insertTaskShareSchema,
  insertTaskTemplateSchema 
} from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Task routes
  app.get('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const filters = {
        status: req.query.status as string,
        priority: req.query.priority as string,
        projectId: req.query.projectId ? parseInt(req.query.projectId as string) : undefined,
        workspaceId: req.query.workspaceId ? parseInt(req.query.workspaceId as string) : undefined,
        dueDate: req.query.dueDate as string,
        search: req.query.search as string,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc',
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const tasks = await storage.getTasks(userId, filters);
      res.json(tasks);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get('/api/tasks/shared', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const sharedTasks = await storage.getSharedTasks(userId);
      res.json(sharedTasks);
    } catch (error) {
      console.error("Error fetching shared tasks:", error);
      res.status(500).json({ message: "Failed to fetch shared tasks" });
    }
  });

  app.post('/api/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const taskData = insertTaskSchema.parse({ ...req.body, userId });
      const task = await storage.createTask(taskData);
      
      // Broadcast to WebSocket clients
      broadcastToUser(userId, { type: 'TASK_CREATED', payload: task });
      
      res.status(201).json(task);
    } catch (error) {
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.put('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const taskId = parseInt(req.params.id);
      const updates = insertTaskSchema.partial().parse(req.body);
      
      const task = await storage.updateTask(taskId, userId, updates);
      
      // Broadcast to WebSocket clients
      broadcastToUser(userId, { type: 'TASK_UPDATED', payload: task });
      
      res.json(task);
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete('/api/tasks/:id', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const taskId = parseInt(req.params.id);
      
      const success = await storage.deleteTask(taskId, userId);
      if (success) {
        // Broadcast to WebSocket clients
        broadcastToUser(userId, { type: 'TASK_DELETED', payload: { id: taskId } });
        res.json({ message: "Task deleted successfully" });
      } else {
        res.status(404).json({ message: "Task not found" });
      }
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Task sharing routes
  app.post('/api/tasks/:id/share', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const taskId = parseInt(req.params.id);
      const shareData = insertTaskShareSchema.parse({
        ...req.body,
        taskId,
        sharedById: userId,
      });
      
      const taskShare = await storage.shareTask(shareData);
      
      // Broadcast to shared user
      broadcastToUser(shareData.userId, { 
        type: 'TASK_SHARED', 
        payload: { taskId, sharedBy: userId } 
      });
      
      res.status(201).json(taskShare);
    } catch (error) {
      console.error("Error sharing task:", error);
      res.status(500).json({ message: "Failed to share task" });
    }
  });

  // Project routes
  app.get('/api/projects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const projects = await storage.getProjects(userId);
      res.json(projects);
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.post('/api/projects', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const projectData = insertProjectSchema.parse({ ...req.body, ownerId: userId });
      const project = await storage.createProject(projectData);
      res.status(201).json(project);
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ message: "Failed to create project" });
    }
  });

  // Workspace routes
  app.get('/api/workspaces', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const workspaces = await storage.getWorkspaces(userId);
      res.json(workspaces);
    } catch (error) {
      console.error("Error fetching workspaces:", error);
      res.status(500).json({ message: "Failed to fetch workspaces" });
    }
  });

  app.post('/api/workspaces', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const workspaceData = insertWorkspaceSchema.parse({ ...req.body, ownerId: userId });
      const workspace = await storage.createWorkspace(workspaceData);
      res.status(201).json(workspace);
    } catch (error) {
      console.error("Error creating workspace:", error);
      res.status(500).json({ message: "Failed to create workspace" });
    }
  });

  // Template routes
  app.get('/api/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const templates = await storage.getTaskTemplates(userId);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.post('/api/templates', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const templateData = insertTaskTemplateSchema.parse({ ...req.body, userId });
      const template = await storage.createTaskTemplate(templateData);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // Analytics routes
  app.get('/api/analytics/tasks', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const dateRange = req.query.dateRange ? {
        start: new Date(req.query.start as string),
        end: new Date(req.query.end as string),
      } : undefined;
      
      const stats = await storage.getTaskStats(userId, dateRange);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.get('/api/analytics/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const stats = await storage.getUserStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user stats" });
    }
  });

  // Gamification routes
  app.get('/api/achievements', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const achievements = await storage.getUserAchievements(userId);
      res.json(achievements);
    } catch (error) {
      console.error("Error fetching achievements:", error);
      res.status(500).json({ message: "Failed to fetch achievements" });
    }
  });

  // Pomodoro routes
  app.post('/api/pomodoro', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { taskId, duration } = req.body;
      const session = await storage.addPomodoroSession(userId, taskId, duration);
      res.status(201).json(session);
    } catch (error) {
      console.error("Error creating pomodoro session:", error);
      res.status(500).json({ message: "Failed to create pomodoro session" });
    }
  });

  app.get('/api/pomodoro', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const dateRange = req.query.dateRange ? {
        start: new Date(req.query.start as string),
        end: new Date(req.query.end as string),
      } : undefined;
      
      const sessions = await storage.getPomodoroSessions(userId, dateRange);
      res.json(sessions);
    } catch (error) {
      console.error("Error fetching pomodoro sessions:", error);
      res.status(500).json({ message: "Failed to fetch pomodoro sessions" });
    }
  });

  // AI suggestions route
  app.get('/api/ai/suggestions', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // AI-powered task suggestions based on user patterns
      const suggestions = await generateAISuggestions(userId);
      res.json(suggestions);
    } catch (error) {
      console.error("Error generating AI suggestions:", error);
      res.status(500).json({ message: "Failed to generate AI suggestions" });
    }
  });

  const httpServer = createServer(app);

  // WebSocket server setup
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const userConnections = new Map<string, Set<WebSocket>>();

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('WebSocket connection established');

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'AUTH' && data.userId) {
          // Associate this connection with the user
          if (!userConnections.has(data.userId)) {
            userConnections.set(data.userId, new Set());
          }
          userConnections.get(data.userId)!.add(ws);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      // Remove connection from all users
      userConnections.forEach((connections, userId) => {
        connections.delete(ws);
        if (connections.size === 0) {
          userConnections.delete(userId);
        }
      });
    });
  });

  // Broadcast function
  function broadcastToUser(userId: string, message: any) {
    const connections = userConnections.get(userId);
    if (connections) {
      const messageStr = JSON.stringify(message);
      connections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      });
    }
  }

  // AI suggestions generator
  async function generateAISuggestions(userId: string) {
    // This would integrate with an AI service in production
    // For now, return mock suggestions based on user patterns
    const userTasks = await storage.getTasks(userId, { limit: 10 });
    const userStats = await storage.getUserStats(userId);
    
    const suggestions = [];
    
    // Suggest based on overdue tasks
    const overdueTasks = userTasks.filter(task => 
      task.dueDate && task.dueDate < new Date() && task.status !== 'completed'
    );
    
    if (overdueTasks.length > 0) {
      suggestions.push({
        type: 'overdue_focus',
        title: 'Focus on overdue tasks',
        description: `You have ${overdueTasks.length} overdue tasks. Consider prioritizing these to get back on track.`,
        action: 'Show overdue tasks',
        priority: 'high'
      });
    }
    
    // Suggest optimal work times based on completion patterns
    const currentHour = new Date().getHours();
    if (currentHour >= 14 && currentHour <= 16) {
      suggestions.push({
        type: 'optimal_time',
        title: 'Peak productivity time',
        description: 'Based on your patterns, you\'re most productive between 2-4 PM. Consider scheduling important tasks now.',
        action: 'Schedule task',
        priority: 'medium'
      });
    }
    
    // Suggest task templates
    const templates = await storage.getTaskTemplates(userId);
    if (templates.length > 0 && userTasks.length < 5) {
      suggestions.push({
        type: 'use_template',
        title: 'Use a task template',
        description: 'You have saved templates that can help you create tasks faster.',
        action: 'Browse templates',
        priority: 'low'
      });
    }
    
    return suggestions;
  }

  return httpServer;
}
