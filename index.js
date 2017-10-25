
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import toNumber from 'yox-common/function/toNumber'
import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'

export default class Observer {

  /**
   * @param {Object} options
   * @property {Object} options.data
   * @property {?Object} options.computed
   * @property {?*} options.context 执行 watcher 函数的 this 指向
   * @property {?Function} options.beforeFlush
   * @property {?Function} options.afterFlush
   */
  constructor(options) {

    let instance = this

    instance.data = options.data || { }
    instance.context = options.context || instance
    instance.emitter = new Emitter()
    instance.beforeFlush = options.beforeFlush
    instance.afterFlush = options.afterFlush

    // 谁依赖了谁
    instance.deps = { }
    // 谁被谁依赖
    instance.invertedDeps = { }
    // 谁被谁依赖
    instance.invertedFuzzyDeps = { }

    // 把计算属性拆为 getter 和 setter
    instance.computedGetters = { }
    instance.computedSetters = { }

    // 计算属性的缓存值
    instance.computedCache = { }

    // 辅助获取计算属性的依赖
    instance.computedStack = [ ]

    // 正在监听的 keypath
    instance.watchKeypaths = { }
    // 模糊监听，如 user.*
    instance.watchFuzzyKeypaths = { }

    // 计算属性也是数据
    if (is.object(options.computed)) {
      object.each(
        options.computed,
        function (item, keypath) {
          instance.addComputed(keypath, item)
        }
      )
    }

  }

  /**
   * 添加计算属性
   *
   * @param {string} keypath
   * @param {Function|Object} computed
   */
  addComputed(keypath, computed) {

    let instance = this, cache = env.TRUE, get, set, deps

    if (is.func(computed)) {
      get = computed
    }
    else if (is.object(computed)) {
      if (is.boolean(computed.cache)) {
        cache = computed.cache
      }
      if (is.func(computed.get)) {
        get = computed.get
      }
      if (is.func(computed.set)) {
        set = computed.set
      }
      if (computed.deps) {
        deps = computed.deps
      }
    }

    if (get) {

      let needDeps

      if (deps) {
        needDeps = env.FALSE
        if (is.array(deps)) {
          instance.setDeps(keypath, deps)
        }
      }
      else {
        needDeps = cache
      }

      instance.computedGetters[ keypath ] = function () {

        if (cache && object.has(instance.computedCache, keypath)) {
          return instance.computedCache[ keypath ]
        }

        if (needDeps) {
          instance.computedStack.push([ ])
        }

        let value = execute(get, instance.context)
        instance.computedCache[ keypath ] = value

        if (needDeps) {
          instance.setDeps(
            keypath,
            array.pop(instance.computedStack)
          )
        }

        return value

      }

    }

    if (set) {
      instance.computedSetters[ keypath ] = function (value) {
        set.call(instance.context, value)
      }
    }

  }

  /**
   * 获取数据
   *
   * @param {string} keypath
   * @param {?*} defaultValue
   * @return {?*}
   */
  get(keypath, defaultValue) {

    let instance = this, result

    // 传入 '' 获取整个 data
    if (keypath === char.CHAR_BLANK) {
      return instance.data
    }

    keypath = keypathUtil.normalize(keypath)

    // 收集计算属性依赖
    let list = array.last(instance.computedStack)
    if (list) {
      array.push(list, keypath)
    }

    let { getter, prop } = matchBestGetter(instance.computedGetters, keypath)
    if (getter) {
      getter = getter()
      if (prop) {
        if (object.exists(getter, prop)) {
          result = { value: getter[ prop ] }
        }
        else if (!is.primitive(getter)) {
          result = object.get(getter, prop)
        }
      }
      else {
        result = { value: getter }
      }
    }

    if (!result) {
      result = object.get(instance.data, keypath)
    }

    return result ? result.value : defaultValue

  }

  /**
   * 更新数据
   *
   * @param {string|Object} keypath
   * @param {?*} value
   */
  set(keypath, value) {

    let instance = this, outerDifferences = { }

    // 数据监听有两种
    // 1. 类似计算属性的依赖关系，如计算属性 A 的依赖是 B 和 C，当 B 或 C 变了，必须检测 A 是否变了
    // 2. watch/watchOnce，只监听单一 keypath 的变化
    //
    // 当我们修改一项数据时
    // 如果是基本类型的数据，需要判断是否有 watcher 正在监听它，以及它是否命中模糊匹配，以及它是否是别的数据的依赖
    // 如果是引用类型的数据，除了有基本类型的判断，还得判断它的属性是否变化，如监听 user.name，修改了 user，也得判断 user.name 是否变化，此外，子属性的变化又会带来一次递归判断
    //
    // 一旦数据发生变化，如果它影响了计算属性，则需立即清除计算属性的缓存，才可获取最新值
    // 而 watcher 的触发则需等到 nextTick 后
    // 也就是说，你必须在设值时知道它会导致哪些数据发生变化，而不是在 nextTick 批量计算

    let addInverted = function (differences, inverted) {
      object.each(
        inverted,
        function (count, invertedKeypath) {
          addDifference(differences, invertedKeypath, env.UNDEFINED, instance.get(invertedKeypath), env.TRUE)
        }
      )
    }

    let addDifference = function (differences, keypath, newValue, oldValue, force) {
      if (force || oldValue !== newValue) {
        // 自己
        differences[ keypath ] = oldValue

        // 依赖
        let inverted = instance.invertedDeps[ keypath ]
        if (inverted) {
          addInverted(differences, inverted)
        }

        object.each(
          instance.invertedFuzzyDeps,
          function (inverted, fuzzyKeypath) {
            if (matchKeypath(keypath, fuzzyKeypath)) {
              addInverted(differences, inverted)
            }
          }
        )

        // 子属性
        let oldIsObject = is.object(oldValue), newIsObject = newIsObject
        if (oldIsObject || newIsObject) {
          let keys
          if (oldIsObject) {
            keys = object.keys(oldValue)
            if (newIsObject) {
              array.each(
                object.keys(newValue),
                function (key) {
                  if (!array.has(keys, key)) {
                    array.push(keys, key)
                  }
                }
              )
            }
          }
          else {
            keys = object.keys(newValue)
          }
          if (keys) {
            array.each(
              keys,
              function (key) {
                addDifference(
                  differences,
                  keypathUtil.join(keypath, key),
                  newIsObject ? newValue[ key ] : env.UNDEFINED,
                  oldIsObject ? oldValue[ key ] : env.UNDEFINED
                )
              }
            )
          }
        }
        else {
          let oldIsArray = is.array(oldValue), newIsArray = is.array(newValue)
          if (oldIsArray || newIsArray) {
            let oldLength = oldIsArray ? oldValue.length : env.UNDEFINED, newLength = newIsArray ? newValue.length : env.UNDEFINED
            addDifference(
              differences,
              keypathUtil.join(keypath, 'length'),
              newLength,
              oldLength
            )
            for (let i = 0, length = getMax(newLength, oldLength); i < length; i++) {
              addDifference(
                differences,
                keypathUtil.join(keypath, i),
                newIsArray ? newValue[ i ] : env.UNDEFINED,
                oldIsArray ? oldValue[ i ] : env.UNDEFINED
              )
            }
          }
        }
      }
    }

    let setValue = function (newValue, keypath) {

      keypath = keypathUtil.normalize(keypath)

      let oldValue = instance.get(keypath), innerDifferences = { }

      addDifference(innerDifferences, keypath, newValue, oldValue)

      let setter = instance.computedSetters[ keypath ]
      if (setter) {
        setter(newValue)
      }
      else {
        let { getter, prop } = matchBestGetter(instance.computedGetters, keypath)
        if (getter && prop) {
          getter = getter()
          if (is.primitive(getter)) {
            return
          }
          else {
            object.set(getter, prop, newValue)
          }
        }
        else {
          object.set(instance.data, keypath, newValue)
        }
      }

      if (newValue !== oldValue) {

        let computedKeypaths = object.keys(instance.computedCache)

        object.each(
          innerDifferences,
          function (oldValue, keypath) {
            if (oldValue !== instance.get(keypath)) {
              outerDifferences[ keypath ] = oldValue

              let invertedKeypaths = instance.invertedDeps[ keypath ]
              let invertedFuzzyKeypaths = [ ]

              object.each(
                instance.invertedFuzzyDeps,
                function (invertedKeypaths, fuzzyKeypath) {
                  if (matchKeypath(keypath, fuzzyKeypath)) {
                    array.push(invertedFuzzyKeypaths, fuzzyKeypath)
                  }
                }
              )

              // 计算属性要立即生效，否则取值会出问题
              array.each(
                computedKeypaths,
                function (computedKeypath, index) {
                  let needRemove
                  if (computedKeypath === keypath
                    || invertedKeypaths && invertedKeypaths[ computedKeypath ]
                  ) {
                    needRemove = env.TRUE
                  }
                  else {
                    array.each(
                      invertedFuzzyKeypaths,
                      function (fuzzyKeypath) {
                        if (instance.invertedFuzzyDeps[ fuzzyKeypath ][ computedKeypath ]) {
                          needRemove = env.TRUE
                          return env.FALSE
                        }
                      }
                    )
                  }
                  if (needRemove) {
                    computedKeypaths.splice(index, 1)
                    delete instance.computedCache[ computedKeypath ]
                  }
                },
                env.TRUE
              )

            }
          }
        )

      }

    }

    if (is.string(keypath)) {
      setValue(value, keypath)
    }
    else if (is.object(keypath)) {
      object.each(keypath, setValue)
    }

    let result = [ ], { differences } = instance

    object.each(
      outerDifferences,
      function (oldValue, keypath) {
        if (oldValue !== instance.get(keypath)) {
          array.push(result, keypath)
          if (!differences) {
            differences = instance.differences = { }
          }
          if (!object.has(differences, keypath)) {
            differences[ keypath ] = oldValue
          }
        }
      }
    )

    if (result.length) {
      instance.flushAsync()
    }

    return result

  }

  flush() {

    let instance = this

    if (instance.pending) {
      delete instance.pending
    }

    let { differences } = instance

    if (differences) {
      delete instance.differences
    }
    else {
      return
    }

    execute(
      instance.beforeFlush,
      instance,
      differences
    )

    object.each(
      differences,
      function (oldValue, keypath) {

        let newValue = instance.get(keypath)

        if (oldValue !== newValue) {

          let args = [ newValue, oldValue, keypath ]
          instance.emitter.fire(keypath, args)

          object.each(
            instance.watchFuzzyKeypaths,
            function (value, key) {
              let match = matchKeypath(keypath, key)
              if (match) {
                let newArgs = object.copy(args)
                array.push(newArgs, match)
                instance.emitter.fire(key, newArgs)
              }
            }
          )

        }

      }
    )

    execute(
      instance.afterFlush,
      instance,
      differences
    )

  }

  flushAsync() {
    let instance = this
    if (!instance.pending) {
      instance.pending = env.TRUE
      nextTask.append(
        function () {
          if (instance.pending) {
            instance.flush()
          }
        }
      )
    }
  }

  setDeps(keypath, value) {
    let { deps, invertedDeps, invertedFuzzyDeps } = this
    let oldValue = deps[ keypath ]
    if (oldValue !== value) {

      let added = [ ], removed = [ ]

      if (oldValue) {
        array.each(
          [ oldValue, value ],
          function (deps) {
            array.each(
              deps,
              function (dep) {
                if (array.has(value, dep)) {
                  if (!array.has(oldValue, dep)) {
                    array.push(added, dep)
                  }
                }
                else if (array.has(oldValue, dep)) {
                  array.push(removed, dep)
                }
              }
            )
          }
        )
      }
      else {
        added = value
      }

      if (removed.length) {

        let remove = function (dep, keypath) {

          let isFuzzy = isFuzzyKeypath(dep)
          let deps = isFuzzy ? invertedFuzzyDeps : invertedDeps

          let target = deps[ dep ]
          if (target[ keypath ] > 0) {
            target[ keypath ]--
            if (deps[ keypath ]) {
              object.each(
                deps[ keypath ],
                function (count, key) {
                  remove(dep, key)
                }
              )
            }
          }

          if (!target[ keypath ]) {
            delete target[ keypath ]
          }

        }

        array.each(
          removed,
          function (dep) {
            remove(dep, keypath)
          }
        )

      }

      if (added.length) {

        let add = function (dep, keypath, autoCreate) {

          let isFuzzy = isFuzzyKeypath(dep)
          let deps = isFuzzy ? invertedFuzzyDeps : invertedDeps

          // dep 是 keypath 的一个依赖
          let target = deps[ dep ]
          if (!target && autoCreate) {
            target = deps[ dep ] = { }
          }
          if (target) {
            if (is.number(target[ keypath ])) {
              target[ keypath ]++
            }
            else {
              target[ keypath ] = 1
            }
            // dep 同样是 keypath 的父级的依赖
            if (deps[ keypath ]) {
              object.each(
                deps[ keypath ],
                function (count, key) {
                  add(dep, key)
                }
              )
            }
          }
        }

        array.each(
          added,
          function (dep) {
            add(dep, keypath, env.TRUE)
          }
        )

      }

      deps[ keypath ] = value

    }

  }

  /**
   * 取反 keypath 对应的数据
   *
   * 不管 keypath 对应的数据是什么类型，操作后都是布尔型
   *
   * @param {string} keypath
   * @return {boolean} 取反后的布尔值
   */
  toggle(keypath) {
    let value = !this.get(keypath)
    this.set(keypath, value)
    return value
  }

  /**
   * 递增 keypath 对应的数据
   *
   * 注意，最好是整型的加法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递增
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递增到的最小值，默认不限制
   * @return {number} 返回递增后的值
   */
  increase(keypath, step, max) {
    let value = toNumber(this.get(keypath), 0) + (is.numeric(step) ? step : 1)
    if (!is.numeric(max) || value <= max) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 递减 keypath 对应的数据
   *
   * 注意，最好是整型的减法，如果涉及浮点型，不保证计算正确
   *
   * @param {string} keypath 值必须能转型成数字，如果不能，则默认从 0 开始递减
   * @param {?number} step 步进值，默认是 1
   * @param {?number} min 可以递减到的最小值，默认不限制
   * @return {number} 返回递减后的值
   */
  decrease(keypath, step, min) {
    let value = toNumber(this.get(keypath), 0) - (is.numeric(step) ? step : 1)
    if (!is.numeric(min) || value >= min) {
      this.set(keypath, value)
    }
    return value
  }

  /**
   * 在数组指定位置插入元素
   *
   * @param {string} keypath
   * @param {*} item
   * @param {number} index
   * @return {?boolean} 是否插入成功
   */
  insert(keypath, item, index) {

    let list = this.get(keypath)
    if (!is.array(list)) {
      list = [ ]
    }
    else {
      list = object.copy(list)
    }

    let { length } = list
    if (index === env.TRUE || index === length) {
      list.push(item)
    }
    else if (index === env.FALSE || index === 0) {
      list.unshift(item)
    }
    else if (index > 0 && index < length) {
      list.splice(index, 0, item)
    }
    else {
      return
    }

    this.set(keypath, list)

    return env.TRUE

  }

  /**
   * 通过索引移除数组中的元素
   *
   * @param {string} keypath
   * @param {number} index
   * @return {?boolean} 是否移除成功
   */
  removeAt(keypath, index) {
    let list = this.get(keypath)
    if (is.array(list)
      && index >= 0
      && index < list.length
    ) {
      list = object.copy(list)
      list.splice(index, 1)
      this.set(keypath, list)
      return env.TRUE
    }
  }

  /**
   * 直接移除数组中的元素
   *
   * @param {string} keypath
   * @param {*} item
   * @return {?boolean} 是否移除成功
   */
  remove(keypath, item) {
    let list = this.get(keypath)
    if (is.array(list)) {
      list = object.copy(list)
      if (array.remove(list, item)) {
        this.set(keypath, list)
        return env.TRUE
      }
    }
  }

  nextTick(fn) {
    nextTask.append(fn)
  }

  /**
   * 销毁
   */
  destroy() {
    this.emitter.off()
    object.clear(this)
  }

}

object.extend(
  Observer.prototype,
  {

    /**
     * 监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watch: createWatch('on'),

    /**
     * 监听一次数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watchOnce: createWatch('once'),

    /**
     * 取消监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     */
    unwatch: function (keypath, watcher) {
      let instance = this
      if (is.string(keypath)) {
        unwatch(instance, keypath, watcher)
      }
      else if (is.object(keypath)) {
        object.each(
          keypath,
          function (watcher, keypath) {
            unwatch(instance, keypath, watcher)
          }
        )
      }
    }

  }
)

function watch(instance, action, keypath, watcher, sync) {

  let { emitter, context } = instance

  let isFuzzy = isFuzzyKeypath(keypath)

  if (!emitter.has(keypath)) {
    if (isFuzzy) {
      instance.watchFuzzyKeypaths[ keypath ] = env.TRUE
    }
    else {
      instance.watchKeypaths[ keypath ] = env.TRUE
    }
  }

  emitter[ action ](
    keypath,
    {
      func: watcher,
      context,
    }
  )

  if (sync && !isFuzzy) {
    execute(
      watcher,
      context,
      [ instance.get(keypath), env.UNDEFINED, keypath ]
    )
  }

}

function unwatch(instance, keypath, watcher) {
  let { emitter } = instance
  if (emitter.has(keypath)) {
    emitter.off(keypath, watcher)
    if (!emitter.has(keypath)) {
      if (isFuzzyKeypath(keypath)) {
        delete instance.watchFuzzyKeypaths[ keypath ]
      }
      else {
        delete instance.watchKeypaths[ keypath ]
      }
    }
  }
}

function createWatch(action) {

  return function (keypath, watcher, sync) {

    let instance = this

    if (is.string(keypath)) {
      watch(instance, action, keypath, watcher, sync)
    }
    else {
      if (watcher === env.TRUE) {
        sync = watcher
      }
      object.each(
        keypath,
        function (value, keypath) {
          let watcher = value, innerSync = sync
          if (is.object(value)) {
            watcher = value.watcher
            if (is.boolean(value.sync)) {
              innerSync = value.sync
            }
          }
          watch(instance, action, keypath, watcher, innerSync)
        }
      )
    }

  }

}

let patternCache = { }

/**
 * 模糊匹配 Keypath
 *
 * @param {string} keypath
 * @param {string} pattern
 * @return {?Array.<string>}
 */
function matchKeypath(keypath, pattern) {
  let cache = patternCache[ pattern ]
  if (!cache) {
    cache = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    cache = patternCache[ pattern ] = new RegExp(`^${cache}$`)
  }
  let match = keypath.match(cache)
  if (match) {
    return array.toArray(match).slice(1)
  }
}

/**
 * 是否模糊匹配
 *
 * @param {string} keypath
 * @return {boolean}
 */
function isFuzzyKeypath(keypath) {
  return string.has(keypath, '*')
}

/**
 * 从 getter 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @param {Object} getters
 * @param {string} keypath
 * @return {Object}
 */
function matchBestGetter(getters, keypath) {

  let result = { }

  array.each(
    object.sort(getters, env.TRUE),
    function (prefix) {
      let length = keypathUtil.startsWith(keypath, prefix)
      if (length !== env.FALSE) {
        result.getter = getters[ prefix ]
        result.prop = string.slice(keypath, length)
        return env.FALSE
      }
    }
  )

  return result

}

/**
 * 获取最大值
 *
 * @param {number|undefined} a
 * @param {number|undefined} b
 * @return {number}
 */
function getMax(a, b) {
  let max
  if (a >= 0) {
    max = a
    if (b > a) {
      max = b
    }
  }
  else if (b >= 0) {
    max = b
  }
  return max
}
