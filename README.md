# Council of Errors

A simple telegram error relay application, to monitor for errors in other applications.

## Build docker image

```
docker build . -t nonhumannonsense/council-of-errors:latest
docker push nonhumannonsense/council-of-errors:latest
```

on Apple silicon, you might need to add `--platform linux/amd64` or similar to the build command

### Licence

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License][cc-by-nc]

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg
