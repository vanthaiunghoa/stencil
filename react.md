```js
export default ReactDOM.createCustomElementType('x-foo', {
  propName: {
    // Attribute name to map to.
    attribute: string | null,

    // Serialize function to convert prop value
    // to attribute string.
    serialize: function | null,

    // Indicates the prop is an event, and the value
    // should be an event handler function.
    // If the event key is used, then all of the other
    // keys (property, attribute, serialize) should throw
    // compile warnings if set.
    event: string | null
  }
  propName2: {
    ...
  }
  ...
});

// XFoo.js
export default ReactDOM.createCustomElementType('x-foo', {
  longName: {
    attribute: 'longname'
  },
  someJSONdata: {
    attribute: 'somejsondata',
    serialize: JSON.stringify
  },
  onURLChanged: {
    event: 'urlchanged'
  }
});



```



```ts
export interface PropDef {
  attribute: string;
  serialize?: Function;
}
export interface EventDef {
  attribute: string;
  event: string
}

export interface PropAttrs {
  [key: string]: PropDef | EventDef;
}

export function wc(customEvents = {}, props = {}) {
  let storedEl;

  return function (el) {
    Object.entries(customEvents).forEach(([name, value]) => {
      // If we have an element then add event listeners
      // otherwise remove the event listener
      const action = (el) ? el.addEventListener : storedEl.removeEventListener;
      if (typeof value === 'function') {
        action(name, value);
        return;
      }
    });
    // If we have an element then set props
    if (el) {
      Object.entries(props).forEach(([name, value]) => {
        el[name] = value;
      });
    }
    storedEl = el;
  };
}

function createReactElement(tagName: string, definedProps: PropAttrs) {
  const events = {};
  const props = {};

  Object.entries(definedProps).forEach(([name, value]) => {
    if (definedProps[name].hasOwnProperty(event)) {
      events[name] = value;
    } else {
      props[name] = value;
    }
  });

  return ({ style, children, ...props}) => {
    return React.createElement(tagName, {
      ref: wc(events, props)
      style: style
    }, children);
  }

  return ReactComponent;
}



export default createReactElement('stencil-route', {
  'url': {
    attribute: 'url'
  }
});
```