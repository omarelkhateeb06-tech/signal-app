export interface CommentAuthor {
  id: string;
  name: string | null;
  email: string;
  profile_picture_url: string | null;
}

export interface Comment {
  id: string;
  story_id: string;
  parent_comment_id: string | null;
  content: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  author: CommentAuthor;
  reply_count: number;
}

export interface CommentList {
  comments: Comment[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}
