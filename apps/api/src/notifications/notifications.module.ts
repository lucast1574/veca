import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  Global,
  Module,
  Param,
  Post,
  Req,
  Sse,
} from "@nestjs/common";
import { interval, map, merge, filter } from "rxjs";
import { z } from "zod";
import { AuthModule } from "../auth/auth.module";
import { SessionEndpoint } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { Notifications } from "./notifications.service";
import { FirebasePush } from "./firebase-push";
@Controller("account/notifications")
@SessionEndpoint()
class NotificationsController {
  constructor(
    private readonly notices: Notifications,
    private readonly push: FirebasePush,
  ) {}
  @Get() list(@Req() req: AuthenticatedRequest) {
    return this.notices.list(req.session.user);
  }
  @Get("config") config() {
    return this.push.configuration();
  }
  @Post("read") allRead(@Req() req: AuthenticatedRequest) {
    return this.notices.read(req.session.user);
  }
  @Post(":id/read") read(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notices.read(req.session.user, id);
  }
  @Sse("events") stream(@Req() req: AuthenticatedRequest) {
    return merge(
      this.notices.changes.pipe(
        filter((change) => change.userId === req.session.user.id),
        map(() => ({ data: { topic: "notifications" } })),
      ),
      interval(20000).pipe(map(() => ({ data: { topic: "heartbeat" } }))),
    );
  }
  @Get(":id") detail(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notices.detail(req.session.user, id);
  }
  @Post("push/register") register(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = parse(
      z
        .object({
          token: z.string().min(20).max(4096),
          accountId: z.string().optional(),
        })
        .strict(),
      body,
    );
    if (data.accountId && data.accountId !== req.session.user.id)
      throw new ForbiddenException(
        "La cuenta cambió. Vuelve a activar los avisos.",
      );
    return this.notices.register(
      req.session.user,
      req.session.tokenHash,
      data.token,
    );
  }
  @Post("push/unregister") unregister(@Req() req: AuthenticatedRequest) {
    return this.notices.unregister(req.session.user, req.session.tokenHash);
  }
  @Post("push/test") test(@Req() req: AuthenticatedRequest) {
    return this.notices.test(req.session.user);
  }
}
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [Notifications, FirebasePush],
  exports: [Notifications],
})
export class NotificationsModule {}
