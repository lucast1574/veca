import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  suggestionCommentCreate,
  suggestionCreate,
  suggestionEdit,
  suggestionId,
  suggestionSection,
  suggestionStatusChange,
} from "@veca/content";
import { SessionEndpoint } from "../auth/route-access";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { parse } from "../common/validation";
import { SuggestionsService } from "./suggestions.service";
const page = z.coerce.number().int().min(1).max(1000).default(1);

@SessionEndpoint()
@Controller("admin/suggestions")
class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}
  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query("page") rawPage?: string,
    @Query("search") search = "",
    @Query("section") section?: string,
  ) {
    return this.suggestions.list(
      req.session.user,
      parse(page, rawPage),
      parse(z.string().trim().max(100), search),
      section ? parse(suggestionSection, section) : undefined,
    );
  }
  @Get(":id")
  detail(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("page") rawPage?: string,
  ) {
    return this.suggestions.detail(
      req.session.user,
      parse(suggestionId, id),
      parse(page, rawPage),
    );
  }
  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    return this.suggestions.create(
      req.session.user,
      parse(suggestionCreate, raw),
    );
  }
  @Put(":id")
  edit(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    return this.suggestions.edit(
      req.session.user,
      parse(suggestionId, id),
      parse(suggestionEdit, raw),
    );
  }
  @Put(":id/status")
  status(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    return this.suggestions.status(
      req.session.user,
      parse(suggestionId, id),
      parse(suggestionStatusChange, raw),
    );
  }
  @Post(":id/comments")
  comment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    return this.suggestions.comment(
      req.session.user,
      parse(suggestionId, id),
      parse(suggestionCommentCreate, raw),
    );
  }
}
@Module({
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
