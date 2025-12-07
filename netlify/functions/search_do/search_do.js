/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const googleSearch = require('./googleSearch.js');

// Simple config object (replaces missing import)
const config = {
  getDefaultLocale: () => 'en'
};

const DESCRIPTION_META_TAG = 'twitter:description';
const PAGE_SIZE = googleSearch.PAGE_SIZE;
const LAST_PAGE = googleSearch.MAX_PAGE;
const MAX_HIGHLIGHT_COMPONENTS = 3;
const MAX_HIGHLIGHT_COMPONENT_INDEX = 7;
const COMPONENT_REFERENCE_DOC_PATTERN =
  /^(?:https?:\/\/[^/]+)?(?:\/[^/]+)?\/documentation\/components\/(amp-[^/]+)/;

const DEFAULT_LOCALE = 'en';

const RESPONSE_MAX_AGE = {
  search: 60 * 60, // 1 hour
  autosuggest: 60 * 60 * 24, // 24 hours
};

/** Will remove/rewrite characters that cause problems when displaying */
function cleanupText(text) {
  // ` is problematic. For example `i will be rendered as Ã¬.
  // It is not clear why, but we can simply convert it.
  text = text.replace(/`/g, "'");
  // sometimes markdown links (that may contain {{g.doc}} calls) are found, so remove them
  text = text.replace(
    /\[([^\]]+)\]\([^\)]*?(?:\{\{[^}]+\}[^\)]*)?(?:\)|$)/g,
    '$1'
  );
  return text;
}

/** do some additional cleanup to ensure the text is printed nicely */
function cleanupTexts(page) {
  page.title = cleanupText(page.title);
  page.description = cleanupText(page.description);
}

function getCseItemMetaTagValue(item, metaTag) {
  // since pagemap has always key:array the metatags dictionary is always the first element in the array
  const pagemap = item.pagemap;
  if (
    pagemap &&
    pagemap.metatags &&
    pagemap.metatags.length > 0 &&
    pagemap.metatags[0][metaTag]
  ) {
    return pagemap.metatags[0][metaTag];
  }
  return null;
}

/** Creates a page object from a CSE search result item */
function createPageObject(item) {
  return {
    title: item.title || '',
    description: item.snippet || '',
    url: item.link || '',
  };
}

/** Adds example and playground links to component pages */
function addExampleAndPlaygroundLink(page, locale) {
  const match = page.url.match(COMPONENT_REFERENCE_DOC_PATTERN);
  if (match && match[1]) {
    const componentName = match[1];
    page.exampleUrl = `/${locale}/documentation/examples/?q=${componentName}`;
    page.playgroundUrl = `https://playground.amp.dev/#url=${encodeURIComponent(page.url)}`;
  }
}

function enrichComponentPageObject(item, page, locale) {
  const description = getCseItemMetaTagValue(item, DESCRIPTION_META_TAG);
  if (description) {
    page.description = description;
  }

  if (page.title) {
    // cut off "Documentation: " prefix...
    const prefixIndex = page.title.lastIndexOf(':');
    if (prefixIndex > 0 && prefixIndex + 1 < page.title.length) {
      page.title = page.title.substring(prefixIndex + 1).trim();
    }
  }

  addExampleAndPlaygroundLink(page, locale);
}

function createResult(
  totalResults,
  page,
  lastPage,
  components,
  pages,
  query,
  locale
) {
  const result = {
    result: {
      totalResults: totalResults,
      currentPage: page,
      pageCount: lastPage,
      components: components,
      pages: pages,
    },
    initial: false,
  };

  if (page == LAST_PAGE && lastPage > LAST_PAGE) {
    result.result.isTruncated = true;
  }

  const searchBaseUrl = `/search/do?q=${encodeURIComponent(query)}&locale=${encodeURIComponent(locale)}&page=`;

  if (page < lastPage && page < LAST_PAGE) {
    result.nextUrl = searchBaseUrl + (page + 1);
  }
  if (page > 1) {
    result.prevUrl = searchBaseUrl + (page - 1);
  }
  return JSON.stringify(result);
}

const handler = async (ev) => {
  const searchQuery = ev.queryStringParameters;

  const locale = searchQuery.locale ? searchQuery.locale : DEFAULT_LOCALE;
  const page = searchQuery.page ? parseInt(searchQuery.page) : 1;
  const query = searchQuery.q ? searchQuery.q.trim() : '';

  // The hidden query ensures we only get results for the configured locales
  const searchOptions = {
    hiddenQuery:
      `more:pagemap:metatags-page-locale:${locale}`,
  };

  if (locale != DEFAULT_LOCALE) {
    // For other languages also include en, since the index only contains the translated pages.
    searchOptions.hiddenQuery =
      `more:pagemap:metatags-page-locale:${config.getDefaultLocale()}` +
      ` OR ${searchOptions.hiddenQuery}`;
    searchOptions.noLanguageFilter = true;
  }

  // FIXED: Changed from request.query to searchQuery
  if (isNaN(page) || page < 1 || query.length == 0) {
    const error =
      'Invalid search params (q=' +
      searchQuery.q +
      ', page=' +
      searchQuery.page +
      ')';
    console.error(error);
    // No error status since an empty query can always happen with our search template
    // and we do not want error messages in the client console

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': ev.headers?.origin || '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({error}),
    };
  }

  let highlightComponents = page == 1;

  let cseResult = undefined;
  try {
    cseResult = await googleSearch.search(query, locale, page, searchOptions);
  } catch (err) {
    // problem was logged before, so simply forward the error
    console.error('Search error:', err);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': ev.headers?.origin || '*',
        'Content-Type': 'text/plain',
        'Cache-Control': `no-cache`,
      },
      body: String(err),
    };
  }

  const totalResults = parseInt(cseResult.searchInformation.totalResults);
  const pageCount = Math.ceil(totalResults / PAGE_SIZE);
  const pages = [];
  const components = [];

  if (totalResults > 0) {
    let componentCount = 0;
    for (let i = 0; i < cseResult.items.length; i++) {
      const item = cseResult.items[i];
      const page = createPageObject(item);

      if (
        highlightComponents &&
        i <= MAX_HIGHLIGHT_COMPONENT_INDEX &&
        COMPONENT_REFERENCE_DOC_PATTERN.test(page.url)
      ) {
        enrichComponentPageObject(item, page, locale);
        components.push(page);
        componentCount++;
        if (componentCount >= MAX_HIGHLIGHT_COMPONENTS) {
          highlightComponents = false;
        }
      } else {
        pages.push(page);
      }

      cleanupTexts(page);
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': ev.headers?.origin || '*',
      'Content-Type': 'application/json',
      'Cache-Control': `max-age=${RESPONSE_MAX_AGE.search}, immutable`,
    },
    body: createResult(
      totalResults,
      page,
      pageCount,
      components,
      pages,
      query,
      locale
    ),
  };
};

module.exports = {handler};
