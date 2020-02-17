/*
 * Copyright (c) 2016-2020 Martin Donath <martin.donath@squidfunk.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

// TODO: remove this after we finished refactoring
// tslint:disable

import "../stylesheets/app.scss"
import "../stylesheets/app-palette.scss"

import { values, identity } from "ramda"
import {
  EMPTY,
  merge,
  of,
  NEVER,
  combineLatest
} from "rxjs"
import {
  delay,
  map,
  switchMap,
  tap,
  skip,
  filter,
  take,
  bufferCount,
  startWith,
  pluck,
  withLatestFrom
} from "rxjs/operators"

import {
  getElement,
  watchToggle,
  getElements,
  watchMedia,
  watchDocument,
  watchLocation,
  watchLocationHash,
  watchViewport,
  watchKeyboard,
  watchToggleMap,
  useToggle,
  setViewportOffset,
  watchViewportFrom,
  getElementOrThrow
} from "./observables"
import { setupSearchWorker } from "./workers"
import { renderSource } from "templates"
import { fetchGitHubStats } from "integrations/source/github"
import { setToggle } from "actions"
import {
  Component,
  mountHeader,
  mountHero,
  mountMain,
  mountNavigation,
  mountSearch,
  mountTableOfContents,
  mountTabs,
  useComponent,
  watchComponentMap
} from "components"
import { mountClipboard } from "./integrations/clipboard"
import { patchTables, patchDetails } from "patches"
import { takeIf, not, isConfig } from "utilities"

/* ------------------------------------------------------------------------- */

document.documentElement.classList.remove("no-js")
document.documentElement.classList.add("js")

/* Test for iOS */
if (navigator.userAgent.match(/(iPad|iPhone|iPod)/g))
  document.documentElement.classList.add("ios")

/* ------------------------------------------------------------------------- */

/**
 * Yes, this is a super hacky implementation. Needs clean up.
 */
function repository() {
  const el = getElement<HTMLAnchorElement>(".md-source[href]") // TODO: dont use classes
  // console.log(el)
  if (!el)
    return EMPTY

  const data = sessionStorage.getItem("repository")
  if (data) {
    const x = JSON.parse(data)
    return of(x)
  }

  // TODO: do correct rounding, see GitHub - done
  function format(value: number) {
    if (value > 999) {
      const digits = +((value - 950) % 1000 > 99)
      return `${(++value / 1000).toFixed(digits)}k`
    } else {
      return value.toString()
    }
  }

  // github repository...
  const [, user, repo] = el.href.match(/^.+github\.com\/([^\/]+)\/?([^\/]+)?.*$/i)

  // storage memoization!?
  // get, if not available, exec and persist

  // getOrRetrieve... storage$.

  // Show repo stats
  if (user && repo) {
    return fetchGitHubStats(user, repo)
      .pipe(
        map(({ stargazers_count, forks_count }) => ([
          `${format(stargazers_count || 0)} Stars`,
          `${format(forks_count || 0)} Forks`
        ])),
        tap(data => sessionStorage.setItem("repository", JSON.stringify(data)))
      )

  // Show user or organization stats
  } else if (user) {
    return fetchGitHubStats(user)
      .pipe(
        map(({ public_repos }) => ([
          `${format(public_repos || 0)} Repositories`
        ])),
        tap(data => sessionStorage.setItem("repository", JSON.stringify(data)))
      )
  }
  return of([])
}

/* ----------------------------------------------------------------------------
 * Functions
 * ------------------------------------------------------------------------- */

/**
 * Initialize Material for MkDocs
 *
 * @param config - Configuration
 */
export function initialize(config: unknown) {
  if (!isConfig(config))
    throw new SyntaxError(`Invalid configuration: ${JSON.stringify(config)}`)

  // pass config here!?
  const document$ = watchDocument()
  const location$ = watchLocation()
  const hash$ = watchLocationHash()
  const keyboard$ = watchKeyboard()
  const viewport$ = watchViewport()
  const tablet$ = watchMedia("(min-width: 960px)")
  const screen$ = watchMedia("(min-width: 1220px)")

  /* ----------------------------------------------------------------------- */

  const worker = setupSearchWorker(config.worker.search, {
    base: config.base
  })

  /* ----------------------------------------------------------------------- */

  watchToggleMap([
    "drawer",                          /* Toggle for drawer */
    "search"                           /* Toggle for search */
  ], { document$ })
  watchComponentMap([
    "container",                       /* Container */
    "header",                          /* Header */
    "header-title",                    /* Header title */
    "hero",                            /* Hero */
    "main",                            /* Main area */
    "navigation",                      /* Navigation */
    "search",                          /* Search */
    "search-query",                    /* Search input */
    "search-reset",                    /* Search reset */
    "search-result",                   /* Search results */
    "tabs",                            /* Tabs */
    "toc"                              /* Table of contents */
  ], { document$ })

  /* Create header observable */
  const header$ = useComponent("header")
    .pipe(
      mountHeader()
    )

  const main$ = useComponent("main")
    .pipe(
      mountMain({ header$, viewport$ })
    )

  /* ----------------------------------------------------------------------- */

  const search$ = useComponent("search")
    .pipe(
      mountSearch(worker, { viewport$, keyboard$ }),
    )

  const navigation$ = useComponent("navigation")
    .pipe(
      mountNavigation({ main$, viewport$, screen$ })
    )

  const toc$ = useComponent("toc")
    .pipe(
      mountTableOfContents({ header$, main$, viewport$, tablet$ })
    )

  const tabs$ = useComponent("tabs")
    .pipe(
      mountTabs({ header$, viewport$, screen$ })
    )

  const hero$ = useComponent("hero")
    .pipe(
      mountHero({ header$, viewport$ })
    )

  /* Create header title toggle */
  useComponent("main")
    .pipe(
      map(el => getElementOrThrow("h1", el)), // catch error? just ignore?
      switchMap(el => {
        return watchViewportFrom(el, { header$, viewport$ })
          .pipe(
            map(({ offset: { y } }) => y >= el.offsetHeight),
            withLatestFrom(useComponent("header-title")),
            tap(([active, title]) => {
              title.dataset.mdState = active ? "active" : ""
            })
          )
      })
    )
      .subscribe()

  // paintHeaderTitle <- same with shadow...

  /* ----------------------------------------------------------------------- */

  // TODO: general keyboard handler...
  // put into main!?

  //   search$
  //     .pipe(
  //       filter(not),
  //       switchMapTo(keyboard$),
  //       filter(key => ["s", "f"].includes(key.type)),
  //       switchMapTo(toggle$)
  //     )
  //       .subscribe(toggle => {
  //         const el = getActiveElement()
  //         if (!(el && mayReceiveKeyboardEvents(el)))
  //           setToggle(toggle, true)
  //       })

  /* ----------------------------------------------------------------------- */

  // Close drawer and search on hash change
  hash$.subscribe(x => {

    useToggle("drawer").subscribe(el => {
      setToggle(el, false)
    })
  })

  // TODO:
  hash$
    .pipe(
      switchMap(hash => {

        return useToggle("search")
          .pipe(
            filter(x => x.checked), // only active
            tap(toggle => setToggle(toggle, false)),
            delay(125), // ensure that it runs after the body scroll reset...
            tap(() => {
              location.hash = " "
              location.hash = hash
            }) // encapsulate this...
          )

      })
    )
      .subscribe()

  /* ----------------------------------------------------------------------- */

  // watchClipboard

  mountClipboard({ document$ })
    .subscribe()

  // TODO: WIP repo rendering
  repository().subscribe(facts => {
    if (facts.length) {
      const sources = getElements(".md-source__repository")
      sources.forEach(repo => {
        repo.dataset.mdState = "done"
        repo.appendChild(
          renderSource(facts)
        )
      })
    }
  })

  patchTables({ document$ })
    .subscribe()

  patchDetails({ document$ })
    .subscribe()

  // scroll lock
  let scroll = 0
  combineLatest([
    useToggle("search")
      .pipe(
        switchMap(watchToggle)
      ),
    tablet$,
  ]).pipe(
      tap(([toggle, tablet]) => {
        if (toggle && !tablet) {
          scroll = scrollY
          setTimeout(() => {
            requestAnimationFrame(() => {
              document.body.style.position = 'fixed';
              document.body.style.top = `-${scroll}px`;
              // data.mdState = lock
            })
          }, 400)
        } else {

          /* Scroll to former position, but wait for 100ms to prevent flashes on
             iOS. A short timeout seems to do the trick */
          setTimeout(() => {
            requestAnimationFrame(() => {
              document.body.style.position = '';
              document.body.style.top = '';
              if (scroll)
                window.scrollTo(0, scroll)
            })
          }, 100)
        }
      })
    )
      .subscribe()

  /* Force 1px scroll offset to trigger overflow scrolling */
  if (true || navigator.userAgent.match(/(iPad|iPhone|iPod)/g)) {
    const scrollable = document.querySelectorAll("[data-md-scrollfix]")
    Array.prototype.forEach.call(scrollable, item => {
      item.addEventListener("touchstart", () => {
        const top = item.scrollTop

        /* We're at the top of the container */
        if (top === 0) {
          item.scrollTop = 1

        /* We're at the bottom of the container */
        } else if (top + item.offsetHeight === item.scrollHeight) {
          item.scrollTop = top - 1
        }
      })
    })
  }

  /* ----------------------------------------------------------------------- */

  const state = {
    search$,
    main$,
    navigation$,
    toc$,
    tabs$,
    hero$
  }

  const { ...rest } = state
  merge(...values(rest))
    .subscribe() // potential memleak <-- use takeUntil

  return {
    // agent,
    state
  }
}