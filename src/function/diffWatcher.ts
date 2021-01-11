import * as string from 'yox-common/src/util/string'
import * as constant from 'yox-common/src/util/constant'
import * as keypathUtil from 'yox-common/src/util/keypath'

import readValue from './readValue'
import diffRecursion from './diffRecursion'

export default function (
  keypath: string,
  newValue: any,
  oldValue: any,
  watcher: object,
  isRecursive: boolean,
  callback: (watchKeypath: string, keypath: string, newValue: any, oldValue: any) => void
) {

  let fuzzyKeypaths: string[] | undefined

  // 遍历监听的 keypath，如果未被监听，则无需触发任何事件
  for (const watchKeypath in watcher) {

    // 模糊监听，如 users.*.name
    if (keypathUtil.isFuzzy(watchKeypath)) {

      // 如果当前修改的是 users.0 整个对象
      // users.0 和 users.*.name 无法匹配
      // 此时要知道设置 users.0 到底会不会改变 users.*.name 需要靠递归了

      // 如果匹配，则无需递归
      if (keypathUtil.matchFuzzy(keypath, watchKeypath) !== constant.UNDEFINED) {
        callback(
          watchKeypath, keypath, newValue, oldValue
        )
      }
      else if (isRecursive) {
        if (fuzzyKeypaths) {
          fuzzyKeypaths.push(watchKeypath)
        }
        else {
          fuzzyKeypaths = [watchKeypath]
        }
      }

    }
    // 不是模糊匹配，直接通过前缀匹配
    else {

      // 比如监听的是 users.0.name，此时修改 users.0，则直接读出子属性值，判断是否相等
      const length = keypathUtil.match(watchKeypath, keypath)
      if (length >= 0) {

        const subKeypath = string.slice(watchKeypath, length),
        subNewValue = readValue(newValue, subKeypath),
        subOldValue = readValue(oldValue, subKeypath)

        if (subNewValue !== subOldValue) {
          callback(
            watchKeypath, watchKeypath, subNewValue, subOldValue
          )
        }

      }

    }

  }

  // 存在模糊匹配的需求
  // 必须对数据进行递归
  // 性能确实会慢一些，但是很好用啊，几乎可以监听所有的数据
  if (fuzzyKeypaths) {
    diffRecursion(keypath, newValue, oldValue, fuzzyKeypaths, fuzzyKeypaths.length, callback)
  }

}