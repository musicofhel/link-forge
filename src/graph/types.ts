export interface LinkNode {
  url: string;
  title: string;
  description: string;
  content: string;
  embedding: number[];
  domain: string;
  savedAt: string;
  discordMessageId: string;
  forgeScore: number;
  contentType: string;
  purpose: string;
  integrationType: string;
  quality: string;
  // Document-specific fields (optional)
  keyConcepts?: string[];
  authors?: string[];
  keyTakeaways?: string[];
  difficulty?: string;
}

export interface CategoryNode {
  name: string;
  description: string;
  linkCount: number;
}

export interface TagNode {
  name: string;
}

export interface TechnologyNode {
  name: string;
  description: string;
}

export interface ToolNode {
  name: string;
  description: string;
  url: string;
}

export interface UserNode {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  interests?: string[];
}

export interface SearchResult {
  link: LinkNode;
  score: number;
  matchType: "vector" | "keyword" | "graph";
  categoryName?: string;
  tags?: string[];
}
