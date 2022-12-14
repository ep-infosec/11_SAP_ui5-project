import path from "node:path";
import {readPackageUp} from "read-pkg-up";
import {readPackage} from "read-pkg";
import {promisify} from "node:util";
import fs from "graceful-fs";
const realpath = promisify(fs.realpath);
import resolve from "resolve";
const resolveModulePath = promisify(resolve);
import logger from "@ui5/logger";
const log = logger.getLogger("graph:providers:NodePackageDependencies");

// Packages to consider:
// * https://github.com/npm/read-package-json-fast
// * https://github.com/npm/name-from-folder ?

/**
 * @public
 * @class
 * @alias @ui5/project/graph/providers/NodePackageDependencies
 */
class NodePackageDependencies {
	/**
	 * Generates a project graph from npm modules
	 *
	 * @public
	 * @param {object} options
	 * @param {string} options.cwd Directory to start searching for the root module
	 * @param {object} [options.rootConfiguration]
	 *		Configuration object to use for the root module instead of reading from a configuration file
	 * @param {string} [options.rootConfigPath]
	 *		Configuration file to use for the root module instead the default ui5.yaml
	 */
	constructor({cwd, rootConfiguration, rootConfigPath}) {
		this._cwd = cwd;
		this._rootConfiguration = rootConfiguration;
		this._rootConfigPath = rootConfigPath;

		// this._nodes = {};
	}

	async getRootNode() {
		const rootPkg = await readPackageUp({
			cwd: this._cwd,
			normalize: false
		});

		if (!rootPkg || !rootPkg.packageJson) {
			throw new Error(
				`Failed to locate package.json for directory ${path.resolve(this._cwd)}`);
		}
		const modulePath = path.dirname(rootPkg.path);
		// this._nodes[rootPkg.packageJson.name] = {
		// 	dependencies: Object.keys(rootPkg.packageJson.dependencies)
		// };
		return {
			id: rootPkg.packageJson.name,
			version: rootPkg.packageJson.version,
			path: modulePath,
			configuration: this._rootConfiguration,
			configPath: this._rootConfigPath,
			_dependencies: await this._getDependencies(modulePath, rootPkg.packageJson, true)
		};
	}

	async getDependencies(node) {
		log.verbose(`Resolving dependencies of ${node.id}...`);
		if (!node._dependencies) {
			return [];
		}
		return Promise.all(node._dependencies.map(async ({name, optional}) => {
			const modulePath = await this._resolveModulePath(node.path, name);
			return this._getNode(modulePath, optional);
		}));
	}

	async _resolveModulePath(baseDir, moduleName) {
		log.verbose(`Resolving module path for '${moduleName}'...`);
		try {
			let packageJsonPath = await resolveModulePath(moduleName + "/package.json", {
				basedir: baseDir,
				preserveSymlinks: false
			});
			packageJsonPath = await realpath(packageJsonPath);

			const modulePath = path.dirname(packageJsonPath);
			log.verbose(`Resolved module ${moduleName} to path ${modulePath}`);
			return modulePath;
		} catch (err) {
			throw new Error(
				`Unable to locate module ${moduleName} via resolve logic: ${err.message}`);
		}
	}

	async _getNode(modulePath, optional) {
		log.verbose(`Reading package.json in directory ${modulePath}...`);
		const packageJson = await readPackage({
			cwd: modulePath,
			normalize: false
		});

		return {
			id: packageJson.name,
			version: packageJson.version,
			path: modulePath,
			optional,
			_dependencies: await this._getDependencies(modulePath, packageJson)
		};
	}

	async _getDependencies(modulePath, packageJson, rootModule = false) {
		const dependencies = [];
		if (packageJson.dependencies) {
			Object.keys(packageJson.dependencies).forEach((depName) => {
				dependencies.push({
					name: depName,
					optional: false
				});
			});
		}
		if (rootModule && packageJson.devDependencies) {
			Object.keys(packageJson.devDependencies).forEach((depName) => {
				dependencies.push({
					name: depName,
					optional: false
				});
			});
		}
		if (!rootModule && packageJson.devDependencies) {
			await Promise.all(Object.keys(packageJson.devDependencies).map(async (depName) => {
				try {
					await this._resolveModulePath(modulePath, depName);
					dependencies.push({
						name: depName,
						optional: true
					});
				} catch (err) {
					// Ignore error since it's a development dependency of a non-root module
				}
			}));
		}
		if (packageJson.optionalDependencies) {
			await Promise.all(Object.keys(packageJson.optionalDependencies).map(async (depName) => {
				try {
					await this._resolveModulePath(modulePath, depName);
					dependencies.push({
						name: depName,
						optional: false
					});
				} catch (err) {
					// Ignore error since it's an optional dependency
				}
			}));
		}
		return dependencies;
	}
}

export default NodePackageDependencies;
