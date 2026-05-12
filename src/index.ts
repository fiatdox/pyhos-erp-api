import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { authRoutes } from "./routes/authRoutes";
import { userRoutes } from "./routes/userRoutes";
import { systemRoutes } from "./routes/systemRoutes";
import { permissionRoutes, roleRoutes, userRoleRoutes } from "./routes/permissionRoutes";
import { hrRoutes } from "./routes/hrRoutes";
import { loggerMiddleware } from "./middlewares/loggerMiddleware";

const app = new Elysia()
  .use(loggerMiddleware)
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: "ERP API Documentation",
          version: "1.0.0",
          description: "API สำหรับระบบ ERP (Core Kon)",
        },
        tags: [
          { name: 'Auth', description: 'Authentication endpoints' },
          { name: 'Users', description: 'User management endpoints' },
          { name: 'System', description: 'System data endpoints (missions, majors, submajors)' },
          { name: 'Permissions', description: 'Permission management endpoints' },
          { name: 'Roles', description: 'Role management and role-permission mapping endpoints' },
          { name: 'HR', description: 'HR endpoints (leave types)' }
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT'
            }
          }
        },
        security: [{ bearerAuth: [] }]
      },
    })
  )
  .use(authRoutes)
  .use(userRoutes)
  .use(systemRoutes)
  .use(permissionRoutes)
  .use(roleRoutes)
  .use(userRoleRoutes)
  .use(hrRoutes)
  //.get("/", () => "Hello Elysia")
  .listen(process.env.PORT || 5000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
