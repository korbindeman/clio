-- Sign-in tables for AUTH_DB, the sign-in database WIP and the main site share.
-- Copy into the site's auth-migrations folder. Add each editor in a later
-- migration; sign-up is disabled:
--   INSERT INTO cms_auth_user (id, name, email, emailVerified, createdAt, updatedAt)
--   VALUES ('editor', 'Editor', 'editor@example.com', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
create table "cms_auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "cms_auth_user" ("id") on delete cascade);

create table "cms_auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "cms_auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "cms_auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "cms_auth_session_userId_idx" on "cms_auth_session" ("userId");

create index "cms_auth_account_userId_idx" on "cms_auth_account" ("userId");

create index "cms_auth_verification_identifier_idx" on "cms_auth_verification" ("identifier");

CREATE TABLE cms_auth_email_limit (email TEXT PRIMARY KEY, nextSendAt INTEGER NOT NULL);

