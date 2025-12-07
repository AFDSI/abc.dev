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

'use strict';

const fetch = require('node-fetch');
const credentials = require('./credentials');
const log = require('@lib/common/log')('Google Search');

// google custom search does not support a page size > 10
const PAGE_SIZE = 10;

// google custom search json api does not support loading more than 100 results
const MAX_PAGE = 10;

const CSE_BASE_URL = 'https://www.googleapis.com/customsearch/v1';

// Use your environment variable names directly
const CSE_ID = process.env.GOOGLE_PROGRAMMABLE_SEARCH_CSE_ID || 'a1a3679a4a68c41f5';
const API_KEY = process.env.GOOGLE_PROGRAMMABLE_SEARCH_API_KEY;

if (API_KEY) {
  log.info('Google Custom Search API key loaded successfully');
} else {
  log.warn(
    'Missing Google Custom Search key, site search will not be available!',
    'Environment variable GOOGLE_PROGRAMMABLE_SEARCH_API_KEY is not set.'
  );
}

async function search(query, locale, page, options = {}) {
  if (!API_KEY) {
    throw Error(
      'Custom search api key not initialized! Check log for errors on startup. ' +
      'Set GOOGLE_PROGRAMMABLE_SEARCH_API_KEY in environment.'
    );
  }

  const startIndex = (page - 1) * PAGE_SIZE + 1;
  let language = locale;
  if (language.length > 2) {
    language = language.substr(0, 2);
  }

  const url = new URL(CSE_BASE_URL);
  url.searchParams.set('cx', CSE_ID);
  url.searchParams.set('key', API_KEY);
  url.searchParams.set('hl', language);
  url.searchParams.set('q', query);
  url.searchParams.set('start', startIndex);
  if (!options.noLanguageFilter) {
    url.searchParams.set('lr', `lang_${language}`);
  }
  if (options.hiddenQuery) {
    url.searchParams.set('hq', options.hiddenQuery);
  }

  log.debug(`Searching: ${query} (locale: ${locale}, page: ${page})`);

  const fetchResponse = await fetch(url.toString());
  if (!fetchResponse.ok) {
    log.error(
      `CSE Error ${fetchResponse.status} for url ${url}: `,
      await fetchResponse.text()
    );
    throw Error('Invalid response for search query');
  }

  const result = await fetchResponse.json();
  log.debug(`Search returned ${result.searchInformation?.totalResults || 0} results`);
  return result;
}

module.exports = {
  search,
  PAGE_SIZE,
  MAX_PAGE,
};
