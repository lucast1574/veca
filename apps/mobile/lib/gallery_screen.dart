import 'dart:async';

// Flutter 3.44 is also used by the iOS build environment.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'gallery_api.dart';
import 'profile_screen.dart';
import 'session.dart';

class GalleryScreen extends ConsumerStatefulWidget {
  const GalleryScreen({super.key, required this.session});
  final GallerySession session;

  @override
  ConsumerState<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends ConsumerState<GalleryScreen> {
  final _search = TextEditingController();
  Timer? _debounce;
  List<Photo> _photos = const [];
  int _page = 0;
  int _pages = 0;
  int _total = 0;
  int _requestId = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load(1));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load(int page) async {
    final requestId = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
      if (page == 1) _page = 0;
    });
    try {
      final result = await ref
          .read(galleryApiProvider)
          .photos(widget.session.token, _search.text.trim(), page);
      if (!mounted || requestId != _requestId) return;
      setState(() {
        _photos = page == 1 ? result.photos : [..._photos, ...result.photos];
        _page = page;
        _pages = result.pages;
        _total = result.total;
        _loading = false;
      });
    } catch (error) {
      if (!mounted || requestId != _requestId) return;
      if (error is GalleryError &&
          (error.status == 401 || error.status == 403)) {
        await ref.read(sessionProvider.notifier).logout(expired: true);
        return;
      }
      setState(() {
        _error = error is GalleryError
            ? error.message
            : 'No pudimos cargar las fotos.';
        _loading = false;
      });
    }
  }

  void _filter(String value) {
    _debounce?.cancel();
    _requestId++;
    setState(() {
      _loading = true;
      _page = 0;
    });
    _debounce = Timer(const Duration(milliseconds: 280), () => _load(1));
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator.adaptive(
          onRefresh: () => _load(1),
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
                sliver: SliverToBoxAdapter(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          SvgPicture.asset(
                            'assets/logo.svg',
                            width: 66,
                            height: 44,
                            semanticsLabel: 'Vidrios VECA',
                          ),
                          IconButton.filledTonal(
                            tooltip: 'Mi perfil',
                            icon: const Icon(Icons.person_outline_rounded),
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => ProfileScreen(session: session),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      Text(
                        'Galería',
                        style: theme.textTheme.displayMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: -2.5,
                          height: 1,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        session.review
                            ? 'Fotos de muestra'
                            : 'Fotos de obra y proyectos',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 24),
                      TextField(
                        controller: _search,
                        maxLength: 120,
                        onChanged: _filter,
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          counterText: '',
                          labelText: 'Buscar fotos',
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  tooltip: 'Limpiar búsqueda',
                                  onPressed: () {
                                    _search.clear();
                                    _filter('');
                                  },
                                  icon: const Icon(Icons.close_rounded),
                                ),
                        ),
                      ),
                      if (_page > 0) ...[
                        const SizedBox(height: 16),
                        Text(
                          _total == 1 ? '1 foto' : '$_total fotos',
                          style: theme.textTheme.labelLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (_page > 0 && _photos.isNotEmpty)
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  sliver: SliverGrid.builder(
                    gridDelegate:
                        const SliverGridDelegateWithMaxCrossAxisExtent(
                          maxCrossAxisExtent: 254,
                          mainAxisSpacing: 14,
                          crossAxisSpacing: 14,
                          childAspectRatio: .93,
                        ),
                    itemCount: _photos.length,
                    itemBuilder: (context, index) => _PhotoTile(
                      key: ValueKey(_photos[index].id),
                      photo: _photos[index],
                      token: session.token,
                      onOpen: () {
                        FocusScope.of(context).unfocus();
                        Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => _PhotoViewer(
                              photos: List.of(_photos),
                              index: index,
                              token: session.token,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 30),
                sliver: SliverToBoxAdapter(
                  child: _GalleryStatus(
                    loading: _loading,
                    error: _error,
                    empty: _page > 0 && _photos.isEmpty,
                    searching: _search.text.isNotEmpty,
                    hasNext: _page > 0 && _page < _pages,
                    onNext: () => _load(_page + 1),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GalleryStatus extends StatelessWidget {
  const _GalleryStatus({
    required this.loading,
    required this.error,
    required this.empty,
    required this.searching,
    required this.hasNext,
    required this.onNext,
  });
  final bool loading;
  final String? error;
  final bool empty;
  final bool searching;
  final bool hasNext;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: CircularProgressIndicator.adaptive()),
      );
    }
    if (error != null || empty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Column(
          children: [
            Text(
              error ??
                  (searching
                      ? 'No encontramos fotos con esa búsqueda.'
                      : 'Aún no hay fotos en la galería.'),
              textAlign: TextAlign.center,
            ),
            if (error != null)
              TextButton(onPressed: onNext, child: const Text('Reintentar')),
          ],
        ),
      );
    }
    return hasNext
        ? Center(
            child: TextButton(
              onPressed: onNext,
              child: const Text('Cargar más fotos'),
            ),
          )
        : const SizedBox.shrink();
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({
    super.key,
    required this.photo,
    required this.token,
    required this.onOpen,
  });
  final Photo photo;
  final String token;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      child: Material(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onOpen,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _PhotoImage(photo: photo, token: token, thumbnail: true),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(11, 8, 11, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      photo.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.labelLarge?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      photo.subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoImage extends StatelessWidget {
  const _PhotoImage({
    required this.photo,
    required this.token,
    this.thumbnail = false,
  });
  final Photo photo;
  final String token;
  final bool thumbnail;

  @override
  Widget build(BuildContext context) {
    return Image.network(
      photo.uri.toString(),
      headers: photo.headers(token),
      cacheWidth: thumbnail ? 500 : null,
      fit: thumbnail ? BoxFit.cover : BoxFit.contain,
      excludeFromSemantics: thumbnail,
      semanticLabel: photo.title,
      loadingBuilder: (context, child, progress) => progress == null
          ? child
          : ColoredBox(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              child: const Center(child: CircularProgressIndicator.adaptive()),
            ),
      errorBuilder: (context, error, stackTrace) => const Center(
        child: Padding(
          padding: EdgeInsets.all(10),
          child: Text('Foto no disponible', textAlign: TextAlign.center),
        ),
      ),
    );
  }
}

class _PhotoViewer extends StatefulWidget {
  const _PhotoViewer({
    required this.photos,
    required this.index,
    required this.token,
  });
  final List<Photo> photos;
  final int index;
  final String token;

  @override
  State<_PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<_PhotoViewer> {
  late final _controller = PageController(initialPage: widget.index);
  late int _index = widget.index;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final photo = widget.photos[_index];
    return Scaffold(
      appBar: AppBar(title: Text('${_index + 1} de ${widget.photos.length}')),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: widget.photos.length,
                onPageChanged: (index) => setState(() => _index = index),
                itemBuilder: (context, index) => InteractiveViewer(
                  maxScale: 4,
                  child: Center(
                    child: _PhotoImage(
                      photo: widget.photos[index],
                      token: widget.token,
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  Text(
                    photo.title,
                    textAlign: TextAlign.center,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(photo.subtitle, textAlign: TextAlign.center),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
