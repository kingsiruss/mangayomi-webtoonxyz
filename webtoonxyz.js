// prettier-ignore
const mangayomiSources = [{
    "name": "Webtoon XYZ",
    "lang": "en",
    "baseUrl": "https://www.webtoon.xyz",
    "apiUrl": "",
    "iconUrl": "https://www.webtoon.xyz/favicon.ico",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.1.0",
    "isNsfw": true,
    "pkgPath": "manga/src/en/webtoonxyz.js",
    "notes": "Madara theme. Cloudflare protected. Set isNsfw true."
}];

class DefaultExtension extends MProvider {
  getHeaders(url) {
    return {
      Referer: this.source.baseUrl,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
  }

  mangaListFromPage(res, selector = ".page-item-detail") {
    const doc = new Document(res.body);
    const list = [];
    const mangaElements = doc.select(selector);

    for (const element of mangaElements) {
      let linkElement = element.selectFirst(".item-summary a, .post-title a, a");
      let name = "";
      let link = "";
      if (linkElement) {
        name = linkElement.text.trim();
        link = linkElement.attr("href");
      }
      const imageElement = element.selectFirst(".item-thumb img, img");
      let imageUrl = imageElement ? this.getImageUrl(imageElement) : "";

      if (name && link) {
        list.push({ name, imageUrl, link });
      }
    }

    const hasNextPage = doc.selectFirst("ul.pager a[rel=next], .pagination .next, a.next") !== null;
    return { list, hasNextPage };
  }

  getImageUrl(imageElement) {
    if (!imageElement) return "";
    return imageElement.attr("data-src") ||
           imageElement.attr("data-lazy-src") ||
           imageElement.attr("data-srcset")?.split(" ")[0] ||
           imageElement.attr("srcset")?.split(" ")[0] ||
           imageElement.attr("data-cfsrc") ||
           imageElement.attr("src") || "";
  }

  toStatus(status) {
    const s = (status || "").toLowerCase();
    if (s.includes("ongoing") || s.includes("publishing")) return 0;
    if (s.includes("completed") || s.includes("complete") || s.includes("end")) return 1;
    if (s.includes("hiatus")) return 2;
    if (s.includes("cancelled") || s.includes("dropped") || s.includes("canceled")) return 3;
    return 5;
  }

  parseRelativeDate(dateStr) {
    if (!dateStr) return String(new Date().valueOf());
    try {
      const lower = dateStr.toLowerCase().trim();
      const match = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
      if (!match) {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? String(new Date().valueOf()) : String(d.valueOf());
      }
      const value = parseInt(match[1]);
      const unit = match[2];
      const calendar = new Date();
      switch (unit) {
        case "second": calendar.setSeconds(calendar.getSeconds() - value); break;
        case "minute": calendar.setMinutes(calendar.getMinutes() - value); break;
        case "hour": calendar.setHours(calendar.getHours() - value); break;
        case "day": calendar.setDate(calendar.getDate() - value); break;
        case "week": calendar.setDate(calendar.getDate() - value * 7); break;
        case "month": calendar.setMonth(calendar.getMonth() - value); break;
        case "year": calendar.setFullYear(calendar.getFullYear() - value); break;
      }
      return String(calendar.valueOf());
    } catch (e) {
      return String(new Date().valueOf());
    }
  }

  getBaseUrl() {
    const preference = new SharedPreferences();
    let base_url = preference.get("domain_url") || this.source.baseUrl;
    if (base_url.endsWith("/")) base_url = base_url.slice(0, -1);
    return base_url;
  }

  async getPopular(page) {
    const url = `${this.getBaseUrl()}/?s&post_type=wp-manga&m_orderby=views&page=${page}`;
    const res = await new Client().get(url, this.getHeaders());
    return this.mangaListFromPage(res);
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    const url = `${this.getBaseUrl()}/?s&post_type=wp-manga&m_orderby=latest&page=${page}`;
    const res = await new Client().get(url, this.getHeaders());
    return this.mangaListFromPage(res);
  }

  async search(query, page, filters) {
    let url = this.getBaseUrl();
    if (query && query.trim()) {
      url += `/?s=${encodeURIComponent(query)}&post_type=wp-manga&page=${page}`;
    } else {
      url += `/?s&post_type=wp-manga&page=${page}`;
      // Simple orderby if filters present
      if (filters && filters.length > 0) {
        const order = filters.find(f => f.name === "orderby");
        if (order && order.state > 0 && order.values[order.state]) {
          url += `&m_orderby=${order.values[order.state].value}`;
        }
      }
    }
    const res = await new Client().get(url, this.getHeaders());
    return this.mangaListFromPage(res);
  }

  async getDetail(url) {
    const fullUrl = url.startsWith("http") ? url : `${this.getBaseUrl()}${url}`;
    const res = await new Client().get(fullUrl, this.getHeaders());
    const doc = new Document(res.body);

    const title = doc.selectFirst("div.post-title h1, h1")?.text?.trim() || "";
    const description = doc.selectFirst("div.summary__content, .description-summary")?.text?.trim() || "";
    const imageElement = doc.selectFirst("div.summary_image img");
    const imageUrl = imageElement ? this.getImageUrl(imageElement) : "";

    const authorEl = doc.selectFirst(".author-content a, .summary-heading:contains(Author) + .summary-content");
    const author = authorEl?.text?.trim() || "";

    const statusEl = doc.selectFirst(".summary-heading:contains(Status) + .summary-content, .post-status");
    const status = this.toStatus(statusEl?.text);

    const genre = [];
    doc.select(".genres-content a, .manga-genres a").forEach(g => {
      const t = g.text?.trim();
      if (t) genre.push(t);
    });

    const chapters = [];
    const chapterElements = doc.select("li.wp-manga-chapter");
    for (const el of chapterElements) {
      const a = el.selectFirst("a");
      if (!a) continue;
      const chapterUrl = a.attr("href");
      const chapterName = a.text?.trim() || "";
      const dateEl = el.selectFirst("span.chapter-release-date, .chapter-release-date");
      const dateUpload = this.parseRelativeDate(dateEl?.text);
      if (chapterName && chapterUrl) {
        chapters.push({ name: chapterName, url: chapterUrl, dateUpload });
      }
    }

    return { title, description, imageUrl, status, author, genre, chapters };
  }

  async getPageList(url) {
    const fullUrl = url.startsWith("http") ? url : `${this.getBaseUrl()}${url}`;
    const res = await new Client().get(fullUrl, this.getHeaders());
    const doc = new Document(res.body);

    const pages = [];
    const imgs = doc.select("div.reading-content .page-break img, .reading-content img.wp-manga-chapter-img, div.page-break img");
    for (const img of imgs) {
      let imageUrl = this.getImageUrl(img);
      if (!imageUrl) continue;
      if (imageUrl.startsWith("//")) imageUrl = "https:" + imageUrl;
      else if (imageUrl.startsWith("/")) imageUrl = this.getBaseUrl() + imageUrl;
      if (imageUrl && !pages.includes(imageUrl)) pages.push(imageUrl);
    }
    return pages;
  }

  getFilterList() {
    return [
      {
        type: "header",
        name: "Filters work best with empty search query"
      },
      {
        type: "select",
        name: "orderby",
        label: "Order By",
        values: [
          { name: "Latest", value: "latest" },
          { name: "Most Views", value: "views" },
          { name: "New", value: "new" },
          { name: "Rating", value: "rating" },
        ],
        state: 0,
      },
    ];
  }

  getSourcePreferences() {
    return [
      {
        key: "domain_url",
        editTextPreference: {
          title: "Override Base URL",
          summary: "Leave empty to use default. Useful if domain changes.",
          value: this.source.baseUrl,
          dialogTitle: "Base URL",
          dialogMessage: "",
        },
      },
    ];
  }
}
