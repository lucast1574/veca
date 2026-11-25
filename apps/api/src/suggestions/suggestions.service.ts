import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canViewAdministration,
  SUGGESTION_COMMENTS_PAGE_SIZE,
  type SessionUser,
  type Suggestion,
  type SuggestionComment,
  type SuggestionContent,
  type SuggestionSummary,
} from "@veca/content";
import { Database } from "../database/database.module";

type TopicRecord = Omit<Suggestion, "id"> & { _id: string };
type CommentRecord = Omit<SuggestionComment, "id"> & { _id: string };
const view = <T extends { _id: string }>(row: T) => {
  const { _id, ...rest } = row;
  return { ...rest, id: _id };
};

@Injectable()
export class SuggestionsService {
  constructor(private readonly database: Database) {}
  private get topics() {
    return this.database.db.collection<TopicRecord>("suggestions");
  }
  private get comments() {
    return this.database.db.collection<CommentRecord>("suggestion_comments");
  }
  private staff(user: SessionUser) {
    if (user.status !== "active" || !user.emailVerified)
      throw new ForbiddenException(
        "Este foro está disponible para el equipo con acceso activo.",
      );
  }
  private async topic(id: string) {
    const row = await this.topics.findOne({ _id: id });
    if (!row) throw new NotFoundException("No encontramos esta sugerencia.");
    return row;
  }
  async list(
    user: SessionUser,
    page: number,
    search: string,
    section?: string,
  ) {
    this.staff(user);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = {
      ...(section && { section }),
      ...(escaped && {
        $or: [
          { title: { $regex: escaped, $options: "i" } },
          { body: { $regex: escaped, $options: "i" } },
        ],
      }),
    };
    const pipeline = [
      { $match: filter },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: (page - 1) * 20 },
      { $limit: 21 },
      {
        $lookup: {
          from: "suggestion_comments",
          localField: "_id",
          foreignField: "suggestionId",
          pipeline: [{ $count: "total" }],
          as: "counts",
        },
      },
    ];
    const rows = await this.topics
      .aggregate<TopicRecord & { counts: { total: number }[] }>(pipeline)
      .toArray();
    return {
      items: rows.slice(0, 20).map(
        ({ counts, ...row }): SuggestionSummary => ({
          ...view(row),
          commentCount: counts[0]?.total || 0,
        }),
      ),
      hasMore: rows.length > 20,
    };
  }
  async detail(user: SessionUser, id: string, page: number) {
    this.staff(user);
    const topic = await this.topic(id);
    const [commentCount, comments] = await Promise.all([
      this.comments.countDocuments({ suggestionId: id }),
      this.comments
        .find({ suggestionId: id })
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * SUGGESTION_COMMENTS_PAGE_SIZE)
        .limit(SUGGESTION_COMMENTS_PAGE_SIZE + 1)
        .toArray(),
    ]);
    return {
      topic: view(topic),
      comments: comments.slice(0, SUGGESTION_COMMENTS_PAGE_SIZE).map(view),
      hasMoreComments: comments.length > SUGGESTION_COMMENTS_PAGE_SIZE,
      commentCount,
    };
  }
  async create(user: SessionUser, input: SuggestionContent & { id: string }) {
    this.staff(user);
    const { id, ...content } = input;
    const now = new Date().toISOString();
    const row: TopicRecord = {
      ...content,
      _id: id,
      status: "open",
      author: { id: user.id, name: user.name || "Equipo VECA" },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.topics.insertOne(row);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const saved = await this.topic(id);
      if (
        saved.author.id !== user.id ||
        saved.title !== content.title ||
        saved.body !== content.body ||
        saved.section !== content.section
      )
        throw new ConflictException(
          "Esta sugerencia ya se envió con otros datos.",
        );
      return view(saved);
    }
    return view(row);
  }
  async edit(
    user: SessionUser,
    id: string,
    input: SuggestionContent & { version: number },
  ) {
    this.staff(user);
    const current = await this.topic(id);
    if (current.author.id !== user.id && !canViewAdministration(user))
      throw new ForbiddenException(
        "Solo puedes editar tus propias sugerencias.",
      );
    const { version, ...content } = input;
    const saved = await this.topics.findOneAndUpdate(
      { _id: id, version },
      {
        $set: { ...content, updatedAt: new Date().toISOString() },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException(
        "La sugerencia cambió. Recarga antes de editarla.",
      );
    return view(saved);
  }
  async status(
    user: SessionUser,
    id: string,
    input: Pick<Suggestion, "version" | "status">,
  ) {
    this.staff(user);
    if (!canViewAdministration(user))
      throw new ForbiddenException(
        "Solo Administración puede cambiar el estado.",
      );
    await this.topic(id);
    const saved = await this.topics.findOneAndUpdate(
      { _id: id, version: input.version },
      {
        $set: { status: input.status, updatedAt: new Date().toISOString() },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!saved)
      throw new ConflictException(
        "El estado cambió. Recarga antes de actualizarlo.",
      );
    return view(saved);
  }
  async comment(
    user: SessionUser,
    id: string,
    input: { id: string; body: string },
  ) {
    this.staff(user);
    await this.topic(id);
    const row: CommentRecord = {
      _id: input.id,
      suggestionId: id,
      body: input.body,
      author: { id: user.id, name: user.name || "Equipo VECA" },
      createdAt: new Date().toISOString(),
    };
    try {
      await this.comments.insertOne(row);
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const saved = await this.comments.findOne({ _id: input.id });
      if (
        !saved ||
        saved.suggestionId !== id ||
        saved.author.id !== user.id ||
        saved.body !== input.body
      )
        throw new ConflictException(
          "Este comentario ya se envió con otros datos.",
        );
      return view(saved);
    }
    return view(row);
  }
}
