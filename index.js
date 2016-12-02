import Promise from 'bluebird';
import pathToRegexp from 'path-to-regexp';

export default () => {
    // A unique object for every navigation, containing the current path we're
    // navigating to. Used in async navigation to check if preempted.
    let currentHandle = { path: '' };

    const state = {
        // Whether we're currently navigating.
        progress: false,
        // Current routed state. Params is a combination of route data and
        // path parameters. The data may provide defaults.
        path: '',
        route: null,
        params: {}
    };

    const getters = {
        // Get full routing state.
        routing: (state) => state,
        // Get the current route params.
        routeParams: (state) => state.params
    };

    const mutations = {
        // Started navigating.
        navigating(state) {
            state.progress = true;
        },
        // Finished navigating.
        navigated(state, { path, route, params }) {
            state.progress = false;
            state.path = path;
            state.route = route;
            state.params = params;
        }
    };

    const actions = {
        // Action called on hash change.
        navigate({ rootState, state, dispatch, commit }, path) {
            // Guard to ignore repeated requests.
            if (currentHandle.path === path) {
                return;
            }
            const handle = currentHandle = { path };

            // Resolve route and extract parameters.
            const params = {};
            const route = router.routes.find(({ re }) => {
                const match = re.exec(path);
                if (match) {
                    re.keys.forEach((key, i) => {
                        params[key.name] = match[i + 1];
                    });
                    return true;
                }
            });

            // Perform all the steps attached to the route.
            commit('navigating');
            (route ?
                Promise.mapSeries(route.steps, (step) => {
                    switch (typeof step) {
                        case 'string':
                            return dispatch(step, params);
                        case 'function':
                            return step({
                                state: rootState,
                                dispatch,
                                commit
                            }, params);
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
            .then(() => {
                // Check if we're still current.
                if (currentHandle === handle) {
                    // Normalize location.hash.
                    // The change event for this will stop at the guard.
                    location.hash = '#' + path;

                    // Commit the change.
                    commit('navigated', { path, route, params });
                }

                return params;
            });
        }
    };

    // Add a route. Routes are matched in the order they are added.
    //
    // Object parameters are defaults to apply to route params when matched.
    //
    // String and function parameters are actions to call, which may also
    // return (a promise for) defaults. They receive the match params object as
    // payload.
    const add = (path, ...steps) => {
        const re = pathToRegexp(path);
        router.routes.push({ path, steps, re });
        return router;
    };

    // Update using the current location.hash.
    const update = ({ dispatch }) => {
        const path = '/' + location.hash.replace(/^[#\/]+/, '');
        return dispatch('navigate', path);
    };

    // Installs the hashchange event listener.
    const install = ({ dispatch }) => {
        window.addEventListener('hashchange', () => {
            update({ dispatch });
        }, false);
    };

    // Start routing. Installs the listener and updates once immediately.
    const start = ({ dispatch }) => {
        install({ dispatch });
        return update({ dispatch });
    };

    // Build the module and router objects.
    const module = { state, getters, mutations, actions };
    const router = { routes: [], module, add, update, install, start };
    return router;
};
