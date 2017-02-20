import Promise from 'bluebird';
import pathToRegexp from 'path-to-regexp';

const normalizePath = (path) => {
    return path.replace(/\/+$/, '');
};

export class Route {
    constructor(basePath, path, steps) {
        this.path = path;
        this.re = pathToRegexp(this.path);
        this.steps = steps;
        this._url = pathToRegexp.compile(basePath + this.path);
    }

    // Generate a URL for this route and the given parameters.
    //
    // The URL will be a full URL, accounting for all parent routers.
    url(params) {
        return '#' + this._url(params);
    }
}

export class Router {
    constructor() {
        this.basePath = '';
        this.baseRoute = null;
        this.parentRouter = null;
        this.storeModule = null;
        this.routes = [];
    }

    // Add a route. Routes are matched in the order they are added.
    //
    // Object parameters are defaults to apply to route params when matched.
    //
    // String and function parameters are actions to call, which may also
    // return (a promise for) defaults. They receive the match params object as
    // payload.
    add(path, ...steps) {
        const route = new Route(this.basePath, path, steps);
        this.routes.push(route);
        return route;
    }

    // Generate a URL for a path and params. Also available on `Route` objects.
    //
    // The URL will be a full URL, accounting for all parent routers.
    url(path, params) {
        const fn = pathToRegexp.compile(this.basePath + path);
        return '#' + fn(params);
    }

    // Match the path to one of the routes.
    //
    // Returns an object with `route` and `params`. If no route is matched,
    // `route` will be `null`.
    match(path, params={}) {
        params.router = this;
        params.route = this.routes.find(({ re }) => {
            const match = re.exec(path);
            if (match) {
                params.length = 0;
                re.keys.forEach((key, i) => {
                    params[key.name] = match[i + 1];
                    if (typeof key.name === 'number') {
                        params.length = key.name + 1;
                    }
                });
                return true;
            }
        });
        return params;
    }

    // Match the path and run route steps.
    //
    // Returns an object with `route` and `params`. If no route is matched,
    // `route` will be `null`, and `params` will have an `error` property.
    exec({ state, dispatch, commit }, path, params={}) {
        this.match(path, params);
        return (params.route ?
            Promise.mapSeries(params.route.steps, (step) => {
                switch (typeof step) {
                    case 'string':
                        return dispatch(step, params);
                    case 'function':
                        return step({ state, dispatch, commit }, params);
                    default:
                        Object.assign(params, step);
                        return;
                }
            }) :
            Promise.reject(Error('Not found'))
        )
            .catch((error) => {
                params.error = error;
            })
            .return(params);
    }

    // Create a new child router, and add a route which delegates to it.
    //
    // Any additional arguments are intermediate steps to run, before
    // delegating to the child router. Returns a new Router instance.
    child(path, ...steps) {
        path = normalizePath(path);

        const RouterClass = this.constructor;
        const child = new RouterClass();
        child.basePath = normalizePath(this.basePath) + path;
        child.baseRoute = this.add(`${path}/*`, ...steps);
        child.parentRouter = this;
        child.storeModule = this.storeModule;

        child.baseRoute.steps.push((store, params) => {
            const restIdx = --params.length;
            const path = '/' + params[restIdx];
            delete params[restIdx];

            return child.exec(store, path, params);
        });

        return child;
    }
}

export default (router=new Router()) => {
    // A unique object for every navigation, containing the current path we're
    // navigating to. Used in async navigation to check if preempted.
    let currentHandle = { path: '' };

    const state = {
        // Whether we're currently navigating.
        progress: false,
        // Current routed state. Params is a combination of route data and
        // path parameters. The data may provide defaults.
        path: '',
        params: {},
    };

    const getters = {
        // Get full routing state.
        routing: (state) => state,
        // Get the current route params.
        routeParams: (state) => state.params,
    };

    const mutations = {
        // Started navigating.
        navigating(state) {
            state.progress = true;
        },
        // Finished navigating.
        navigated(state, { path, params }) {
            state.progress = false;
            state.path = path;
            state.params = params;
        },
    };

    const actions = {
        // Action called on hash change.
        navigate({ rootState, state, dispatch, commit }, path) {
            // Guard to ignore repeated requests.
            if (currentHandle.path === path) {
                return;
            }
            const handle = currentHandle = { path };
            // Match and execute the route.
            commit('navigating');
            return router.exec({ state: rootState, dispatch, commit}, path)
                .tap((params) => {
                    return router.post(params)
                        .catch((error) => {
                            params.error = error;
                        })
                })
                .tap((params) => {
                    // Check if we're still current.
                    if (currentHandle === handle) {
                        // Normalize location.hash.
                        // The change event for this will stop at the guard.
                        location.hash = '#' + path;
                        // Commit the change.
                        commit('navigated', { path, params });
                    }
                });
        },
    };

    // Post-routing (pre-navigation) hook.
    router.post = () => {};

    // Export a Vuex module.
    router.storeModule = { state, getters, mutations, actions };

    // Update using the current location.hash.
    router.update = ({ dispatch }) => {
        const path = '/' + location.hash.replace(/^[#\/]+/, '');
        return dispatch('navigate', path);
    };

    // Installs the `hashchange` event listener.
    router.install = ({ dispatch }) => {
        window.addEventListener('hashchange', () => {
            router.update({ dispatch });
        }, false);
    };

    // Start routing. Installs the listener and updates once immediately.
    router.start = ({ dispatch }) => {
        router.install({ dispatch });
        return router.update({ dispatch });
    };

    return router;
};
