import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { authRoutes } from "./routes/authRoutes";
import { userRoutes } from "./routes/userRoutes";
import { systemRoutes } from "./routes/systemRoutes";
import { permissionRoutes, roleRoutes, userRoleRoutes } from "./routes/permissionRoutes";
import { hrRoutes } from "./routes/hrRoutes";
import { itRoutes } from "./routes/itRoutes";
import { equipmentRoutes } from "./routes/equipmentRoutes";
import { hisRoutes } from "./routes/hisRoutes";
import { itRiskRoutes } from "./routes/itRiskRoutes";
import { itActivityRoutes } from "./routes/itActivityRoutes";
import { itIncidentReportRoutes } from "./routes/itIncidentReportRoutes";
import { itUserRequestRoutes } from "./routes/itUserRequestRoutes";
import { userRolesRoutes } from "./routes/userRolesRoutes";
import { accountingRoutes } from "./routes/accountingRoutes";
import { medicalStatRoutes } from "./routes/medicalStatRoutes";
import { itRoadmapRoutes, itRoadmapSwaggerTags } from "./routes/itRoadmapRoutes";
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
          { name: 'Equipment', description: 'ค้นหาครุภัณฑ์จากฐานข้อมูล deprecia' },
          { name: 'HIS', description: 'HIS endpoints (online sessions)' },
          { name: 'HR', description: 'HR endpoints (leave types)' },
          { name: 'IT', description: 'IT endpoints (equipment types)' },
          { name: 'IT Activity', description: 'IT Activity Log — HAIT ข้อ 4.5 บันทึกกิจกรรมเจ้าหน้าที่ IT' },
          { name: 'IT Incident Report', description: 'IT Incident Report — รายงานและติดตามเหตุการณ์ด้าน IT' },
          { name: 'IT User Request', description: 'IT User Request — การขอรหัสผู้ใช้งานระบบ (ส่ง credential ผ่านหมอพร้อม)' },
          { name: 'IT Risk', description: 'IT Risk Management (TMI/ISO 27001)' },
          
          { name: 'System', description: 'System data endpoints (missions, majors, submajors)' },
          { name: 'Users', description: 'User management endpoints' },
          { name: 'Users - Permissions', description: 'Permission management endpoints' },
          { name: 'Users - Roles', description: 'Role management and role-permission mapping endpoints' },
          // แท็กของโมดูล IT Roadmap — นิยามไว้ในไฟล์ route (แก้ที่เดียว)
          ...itRoadmapSwaggerTags,
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
  .use(userRolesRoutes)
  .use(hrRoutes)
  .use(itRoutes)
  .use(equipmentRoutes)
  .use(hisRoutes)
  .use(itRiskRoutes)
  .use(itActivityRoutes)
  .use(itIncidentReportRoutes)
  .use(itUserRequestRoutes)
  .use(accountingRoutes)
  .use(medicalStatRoutes)
  .use(itRoadmapRoutes)
  //.get("/", () => "Hello Elysia")
  .listen(process.env.PORT || 5000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
