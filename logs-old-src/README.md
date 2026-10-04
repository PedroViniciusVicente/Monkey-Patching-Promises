## label-operations.js
combines different async operations based on the line of the test file
```
node label-operations.js test_async_await_fs-trace.jsonl
```

## graph_builder.js
prints a graph that can be visualized using mermaid of the relation of the logs
```
node graph_builder.js test_async_await_fs-trace.jsonl test_async_await_fs.spec.js
```

## graph_and_label.js
creates timeline.html visualization
```
node graph_and_label.js test_async_await_fs-trace.jsonl --html timeline.html
```

## graph_and_label_v3.py
creates interactive test_async_await_fs_graph_v3.html visualization

```
cd logs-old-src
python3 graph_and_label_v3.py test_async_await_fs-trace.jsonl test_async_await_fs.spec.js --output test_async_await_fs_graph_v3.html
```

Right click + Copy Path, then paste in browser
