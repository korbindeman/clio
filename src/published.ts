import config from "virtual:clio/config";

const empty = (id: string) => (config.documents[id] === "object" ? {} : []);

// Published content for the public pages. The WIP Worker reads it from D1 on
// each request. A static release reads the snapshot taken from WIP at build
// time (see the release script); the build defines STATIC_RELEASE, so each
// build keeps only one of these branches.
export const loadPublished: (id: string) => Promise<unknown> = import.meta.env
  .STATIC_RELEASE
  ? async (id) => (await import("./releaseSnapshot.ts")).readSnapshotDocument(id)
  : async (id) => {
      const [{ cmsEnv }, { readPublishedJson }] = await Promise.all([
        import("./login.ts"),
        import("./store.ts"),
      ]);
      return readPublishedJson(cmsEnv().CMS_DB, id, empty(id));
    };
