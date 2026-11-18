-- The core CMS tables. Copy into the site's migrations folder as its first migration.
CREATE TABLE cms_documents (
  id TEXT PRIMARY KEY,
  draft TEXT NOT NULL CHECK(json_valid(draft)),
  published TEXT CHECK(published IS NULL OR json_valid(published)),
  revision INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE cms_history (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  draft TEXT NOT NULL,
  published TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER cms_document_history AFTER UPDATE ON cms_documents BEGIN
  INSERT INTO cms_history(document_id, revision, draft, published, actor, created_at)
  VALUES(OLD.id, OLD.revision, OLD.draft, OLD.published, OLD.actor, OLD.updated_at);
END;

CREATE TABLE cms_media (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  variants TEXT NOT NULL CHECK(json_valid(variants)),
  original_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL
);

-- Preview loops are uploaded separately from images and have no dimensions to store.
CREATE TABLE cms_clips (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL
);

-- Sign-in tables. Local development keeps sign-ins in this database.
create table "cms_auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "cms_auth_user" ("id") on delete cascade);

create table "cms_auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "cms_auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "cms_auth_session_userId_idx" on "cms_auth_session" ("userId");

create index "cms_auth_account_userId_idx" on "cms_auth_account" ("userId");

create index "cms_auth_verification_identifier_idx" on "cms_auth_verification" ("identifier");

CREATE TABLE cms_auth_email_limit (email TEXT PRIMARY KEY, nextSendAt INTEGER NOT NULL);

