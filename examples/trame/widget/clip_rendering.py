# Should import classes from vtkmodules
# but as an example we use vtk for simplicity
import vtk

from pathlib import Path

from trame.app import TrameApp
from trame.decorators import change
from trame.ui.vuetify3 import SinglePageLayout
from trame.widgets import vuetify3, vtklocal, client

DATA_PATH = str(Path(__file__).with_name("star-fighter.vtp").resolve())


class Clip(TrameApp):
    def __init__(self, server=None):
        super().__init__(server)
        self._setup_vtk()
        self._build_ui()

    def _setup_vtk(self):
        renderer = vtk.vtkRenderer()
        renderWindow = vtk.vtkRenderWindow()
        renderWindow.AddRenderer(renderer)
        renderWindow.OffScreenRenderingOn()

        renderWindowInteractor = vtk.vtkRenderWindowInteractor()
        renderWindowInteractor.SetRenderWindow(renderWindow)
        renderWindowInteractor.GetInteractorStyle().SetCurrentStyleToTrackballCamera()

        reader = vtk.vtkXMLPolyDataReader(file_name=DATA_PATH)
        bounds = reader().GetBounds()

        plane = vtk.vtkPlane(
            origin=(
                0.5 * (bounds[0] + bounds[1]),
                0.5 * (bounds[2] + bounds[3]),
                0.5 * (bounds[4] + bounds[5]),
            ),
        )
        mapper = vtk.vtkPolyDataMapper()
        mapper.AddClippingPlane(plane)
        reader >> mapper

        actor = vtk.vtkActor(mapper=mapper)
        renderer.AddActor(actor)

        renderer.ResetCamera()
        renderWindow.Render()

        # region widget
        # Widget setup
        rep = vtk.vtkImplicitPlaneRepresentation(
            place_factor=1.25,
            outline_translation=False,
        )
        rep.DrawPlaneOff()
        rep.PlaceWidget(bounds)
        rep.normal = plane.normal
        rep.origin = plane.origin

        plane_widget = vtk.vtkImplicitPlaneWidget2(
            interactor=renderWindowInteractor, representation=rep
        )
        plane_widget.On()
        # endregion widget

        self.plane = plane
        self.render_window = renderWindow
        self.actor = actor
        self.mapper = mapper
        self.widget = plane_widget
        self.widget_rep = rep

    def _build_ui(self):
        with SinglePageLayout(self.server) as layout:
            self.ui = layout

            layout.title.set_text("WASM Widget")
            layout.icon.click = self.ctrl.view_reset_camera
            layout.toolbar.density = "compact"

            with layout.content:
                # from trame.widgets.vtk import VtkRemoteView
                # with VtkRemoteView(self.render_window) as view:
                #     self.ctrl.view_update = view.update
                #     self.ctrl.view_reset_camera = view.reset_camera

                #     def update_plane(*_):
                #         self.plane.SetOrigin(self.widget_rep.GetOrigin())
                #         self.plane.SetNormal(self.widget_rep.GetNormal())
                #         self.ctrl.view_update()

                #     self.widget.AddObserver("InteractionEvent", update_plane)
                with vtklocal.LocalView(
                    self.render_window,
                    throttle_rate=20,
                    ctx_name="wasm_view",
                    updated="utils.get('setupWidget')()",
                ) as view:
                    self.ctrl.view_update = view.update_throttle
                    self.ctrl.view_reset_camera = view.reset_camera

            client.Script(f"""
                function setupWidget() {{
                    const widget = trame.refs.{self.ctx.wasm_view.ref_name}.getVtkObject({self.ctx.wasm_view.register_vtk_object(self.widget)});
                    const plane = trame.refs.{self.ctx.wasm_view.ref_name}.getVtkObject({self.ctx.wasm_view.register_vtk_object(self.plane)});
                    widget.$observe("InteractionEvent", () => {{
                        plane.origin = widget.widgetRepresentation.origin;
                        plane.normal = widget.widgetRepresentation.normal;
                    }});
                    console.log("widget", widget.$id);
                    console.log("plane", plane.$id);
                }}
                window.setupWidget = setupWidget;
            """)


def main():
    # region export
    import sys

    app = Clip()
    if "--export" in sys.argv:
        app.ctx.wasm_view.save("star-fighter2.wazex")

    app.server.start()
    # endregion export


if __name__ == "__main__":
    main()
